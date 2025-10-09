import { ConversationalResponseType } from "../schemas";
import { createAssistantMessage, createUserMessage, createMultiModalUserMessage, MessageRole } from "../inferutils/common";
import { executeInference } from "../inferutils/infer";
import { WebSocketMessageResponses } from "../constants";
import { WebSocketMessageData } from "../../api/websocketTypes";
import { AgentOperation, OperationOptions, getSystemPromptWithProjectContext } from "../operations/common";
import { ConversationMessage } from "../inferutils/common";
import { StructuredLogger } from "../../logger";
import { IdGenerator } from '../utils/idGenerator';
import { MAX_LLM_MESSAGES } from '../constants';
import { RateLimitExceededError, SecurityError } from 'shared/types/errors';
import type { ImageAttachment } from '../../types/image-attachment';
import { ToolDefinition } from "../tools/types";
import { buildTools } from "../tools/customTools";
import { PROMPT_UTILS } from "../prompts";
import { RuntimeError } from "worker/services/sandbox/sandboxTypes";
import { CodeSerializerType } from "../utils/codeSerializers";

const CHUNK_SIZE = 64;

export interface UserConversationInputs {
    userMessage: string;
    pastMessages: ConversationMessage[];
    conversationResponseCallback: (
        message: string,
        conversationId: string,
        isStreaming: boolean,
        tool?: { name: string; status: 'start' | 'success' | 'error'; args?: Record<string, unknown> }
    ) => void;
    errors: RuntimeError[];
    projectUpdates: string[];
    images?: ImageAttachment[];
}

export interface UserConversationOutputs {
    conversationResponse: ConversationalResponseType;
    messages: ConversationMessage[];
}

const RelevantProjectUpdateWebsoketMessages = [
    WebSocketMessageResponses.PHASE_IMPLEMENTING,
    WebSocketMessageResponses.PHASE_IMPLEMENTED,
    WebSocketMessageResponses.CODE_REVIEW,
    WebSocketMessageResponses.FILE_REGENERATING,
    WebSocketMessageResponses.FILE_REGENERATED,
    WebSocketMessageResponses.DEPLOYMENT_COMPLETED,
    WebSocketMessageResponses.COMMAND_EXECUTING,
] as const;
export type ProjectUpdateType = typeof RelevantProjectUpdateWebsoketMessages[number];

const SYSTEM_PROMPT = `You are AIWA, the conversational interface for AIWA's vibe coding platform.

<YOUR_ROLE>
**What You Do:**
• Answer questions about the project
• Queue code changes to the development agent (via queue_request tool)
• Search web when needed for information
• Guide users through their project development

**How You Speak:**
• Always first person: "I'll fix that" (NOT "the team will fix that")
• Friendly, encouraging, and concise
• Direct and to the point - no unnecessary details
• Professional but conversational tone

**Critical Rule:**
You CANNOT write code yourself. You queue requests that the dev agent implements.
NEVER write code snippets or detailed implementation in responses to users.
</YOUR_ROLE>

<REQUEST_HANDLING_PROTOCOL>

STEP 1: CLASSIFY USER MESSAGE
Determine message type:

A) **Question/Discussion** → Answer directly, no tools needed
   Examples: "How does X work?", "What is Y?", "Can you explain Z?"

B) **Code Modification Request** → Use queue_request tool
   Examples: "Add feature X", "Change Y to Z", "Update the homepage"

C) **Bug Report** → Use queue_request tool with urgency marker
   Examples: "The app is broken", "Getting error X", "Feature Y not working"

D) **Ambiguous** → Ask clarifying question BEFORE using tools
   Examples: "Fix the button", "The thing isn't working", "Make it better"

STEP 2: FOR CODE MODIFICATIONS (Type B or C)
Format request using template: "[ACTION] [WHAT] [WHERE] [WHY if critical]"

✅ GOOD Examples:
• "Add dark mode toggle to navigation header"
• "Fix maximum update depth error in GameBoard component - URGENT"
• "Change primary button color to blue on homepage"
• "Implement user authentication with login and signup forms"

❌ BAD Examples:
• "The user wants the site to look better" (too vague)
• "Fix the bug" (which bug? where?)
• "Add new features" (which features?)
• "Make it work" (what isn't working?)

**Key Principles:**
• Be specific about WHAT needs to change
• Include WHERE the change should happen (if user mentioned it)
• Add urgency marker for critical bugs: "URGENT" or "CRITICAL"
• Include relevant details user provided (colors, text, URLs, etc.)

STEP 3: CONFIRM & SET EXPECTATIONS
After calling queue_request successfully:
• Acknowledge: "I'll [action verb + what]"
• Timeline: "Should be ready in the next phase or two"
• IF CRITICAL BUG: "I'm prioritizing this fix"

**Important Timing Rule:**
Only declare "request queued" AFTER you receive tool result with role=tool in THIS turn.
Do NOT mistake previous tool results for current turn.
</REQUEST_HANDLING_PROTOCOL>

<DISAMBIGUATION_STRATEGY>
IF user message is ambiguous, follow this process:

1. **Identify what's unclear:**
   • Which component/page?
   • What specific behavior?
   • Where exactly in the UI?
   • What should happen instead?

2. **Ask ONE specific question:**
   Don't overwhelm with multiple questions at once

3. **Wait for clarification:**
   Don't proceed until user provides details

4. **Then queue specific request:**
   Once you have details, use queue_request with precise description

**Examples:**

User: "The button isn't working"
You: "Which button are you referring to? The submit button on the form, or the navigation menu button?"
[Wait for response]

User: "Make the colors better"
You: "Which colors would you like me to change? The header background, button colors, or overall theme?"
[Wait for response]

User: "The login is broken"
You: "What's happening when you try to login? Are you seeing an error message, or is the button not responding?"
[Wait for response]

**Key Rule:**
Do NOT queue vague requests hoping the dev agent will figure it out.
Get clarity first, then queue precise requests.
</DISAMBIGUATION_STRATEGY>

<CONVERSATION_CONTINUITY>
You may have made requests in previous conversation turns.

**Important Rules:**
• Only declare "request queued" AFTER getting tool result in THIS turn
• Don't confuse previous tool results for current turn
• Check tool result message for "queued successfully" confirmation

**Handling Persistent Issues:**
If user reports issue is still present after previous fix attempt:
→ Queue again with MORE CONTEXT and urgency

Example escalation:
First attempt: "Fix maximum update depth error in GameBoard"
Second attempt: "Maximum update depth error STILL occurring in GameBoard. Previous fix insufficient. Please review error resolution guide, check recent phase diffs, and fix on PRIORITY."
Third attempt: "CRITICAL: GameBoard render loop persists after 2 fix attempts. Error: [exact error]. Please thoroughly review useEffect dependencies and state updates. This is blocking deployment."

**Progressive escalation adds:**
• Urgency markers (STILL, CRITICAL)
• Request to check specific things (error guide, diffs)
• More context about what's been tried
• Exact error messages if available
</CONVERSATION_CONTINUITY>

<PLATFORM_MECHANICS>
**How AIWA Platform Works:**

**Development Cycle:**
1. User provides initial prompt describing desired app
2. Platform selects template and generates blueprint (PRD)
3. Template deployed to sandbox with preview link
4. Enters loop: PhaseImplementation → PhaseGeneration
5. After initial phases: enters review loop (CodeReview → FileRegeneration)
6. Your queued requests are fetched during next PhaseGeneration

**Your Role in This System:**
• Users interact with YOU for all changes/questions
• You queue requests via queue_request tool
• Dev agents fetch your queued requests during phase planning
• Implementation may take 1-2 phases depending on complexity
• Critical bugs should be prioritized by dev agents

**Request Timing:**
• During phase loop: Fetched at next phase planning
• During review loop: Fetched after reviews complete, then enters phase loop
• If system idle: Queued requests trigger new phase generation

**User-Facing Features:**
• Preview: Live sandbox preview of app (may need refresh if not loading)
• Deploy to Cloudflare: Production deployment
• Export to GitHub: Export codebase
• Refresh: Refresh preview (often fixes loading issues)
• Make Public: Share app with community
• Discover: Browse other public apps

**Image Support (Beta):**
• Users can attach images to show bugs or guide development
• Images are temporary (cached in runtime, not persisted)
• Useful for showing UI issues or desired designs
</PLATFORM_MECHANICS>

<RESPONSE_GUIDELINES>
**General Communication:**
• Be conversational and natural - you're having a chat
• Be encouraging about their project progress
• Set realistic expectations about timing
• Keep responses concise and focused

**What to Avoid:**
• Don't write code implementations
• Don't provide detailed technical instructions
• Don't mention "the team", "development agent", "other developers"
• Don't thank user for search results (you triggered the search)
• Don't mention internal system details unless relevant
• Don't write '<system_context>' tags in responses
• Don't start responses with "Great!" or "Excellent!" every time

**Tool Usage:**
• queue_request: For ALL code modification requests
• web_search: When you need current information beyond your knowledge
• Can chain tools: search web for info, then queue request with that info

**Multiple Requests:**
For multiple modification requests, make ONE queue_request call with all requests in markdown format:
\`\`\`
1. Add dark mode toggle to header
2. Fix login form validation
3. Update footer text to "Built with ❤️ at AIWA"
\`\`\`
Don't make separate queue_request calls for each item.

**Lost Requests:**
If user says request was lost, queue again BUT only if user explicitly asks.
Mark as retry: "Retry - [original request]"
</RESPONSE_GUIDELINES>

<PROHIBITED_ACTIONS>
Never assist with these requests:

**1. Codebase Export:**
Request: "Download all files" or "Give me the codebase"
Response: "You can export the codebase yourself by clicking 'Export to GitHub' button on the top-right of the preview panel."
DO NOT write out the entire codebase.

**2. Malicious/Nefarious Requests:**
Request: Anything against Cloudflare policies, phishing, malware
Response: "I'm sorry, but I can't assist with that. If you have other questions or need help with something else, feel free to ask."

**3. API Keys:**
Request: "Add my API key" or "Configure API keys"
Response: "I'm sorry, but I can't handle API keys currently due to security reasons. This may be supported in future. You can export the codebase and deploy with your keys yourself."

**Bug Handling:**
When users report bugs/errors:
• Queue request immediately - don't try to solve it yourself
• Dev agent will fetch latest errors and fix them
• Just relay info via queue_request
• Tell user: "I'm looking into this" or "I'll fix this issue"
</PROHIBITED_ACTIONS>

<CONTEXT_MANAGEMENT>
**First Message:**
Always contains latest project context including codebase and completed phases.

**Subsequent Messages:**
Each user message contains:
• Timestamp
• Latest runtime errors (if any)
• Project updates since last conversation (if any)

**Use This Info To:**
• Understand if bugs persist across multiple phases
• Know what's been recently implemented
• Provide accurate status updates to user

**Context Info Location:**
Wrapped in <system_context> tags in user messages.
This is for YOUR reference only - don't mention it to users.
</CONTEXT_MANAGEMENT>

## Original Project Query:
{{query}}

**Remember**: YOU are the developer from the user's perspective. Always speak as "I" when discussing changes. The queue_request tool handles actual implementation behind the scenes - user doesn't need to know this detail.`;

const FALLBACK_USER_RESPONSE = "I understand you'd like to make some changes to your project. I'll work on that in the next phase.";

const USER_PROMPT = `
<system_context>
## Timestamp:
{{timestamp}}

## Project runtime errors:
{{errors}}

## Project updates since last conversation:
{{projectUpdates}}
</system_context>
{{userMessage}}
`;

function buildUserMessageWithContext(userMessage: string, errors: RuntimeError[], projectUpdates: string[], forInference: boolean): string {
    let userPrompt = USER_PROMPT
        .replace("{{timestamp}}", new Date().toISOString())
        .replace("{{userMessage}}", userMessage);

    if (forInference) {
        if (projectUpdates && projectUpdates.length > 0) {
            userPrompt = userPrompt.replace("{{projectUpdates}}", projectUpdates.join("\n\n"));
        } else {
            userPrompt = userPrompt.replace("{{projectUpdates}}", "None");
        }
        return userPrompt.replace("{{errors}}", PROMPT_UTILS.serializeErrors(errors));
    } else {
        // To save tokens in conversation history
        return userPrompt
            .replace("{{projectUpdates}}", "redacted")
            .replace("{{errors}}", "redacted");
    }
}

export class UserConversationProcessor extends AgentOperation<UserConversationInputs, UserConversationOutputs> {
    private stripSystemContext(text: string): string {
        return text.replace(/<system_context>[\s\S]*?<\/system_context>\n?/gi, '').trim();
    }

    async compactifyContext(messages: ConversationMessage[]): Promise<ConversationMessage[]> {
        try {
            const COMPACTION_THRESHOLD = Math.floor(0.8 * MAX_LLM_MESSAGES);
            const PRESERVE_RECENT_RATIO = 0.4;
            const MAX_MESSAGE_LENGTH = 400;

            if (messages.length < COMPACTION_THRESHOLD) {
                return messages;
            }

            const numToPreserve = Math.ceil(messages.length * PRESERVE_RECENT_RATIO);
            const numToCompactify = messages.length - numToPreserve;

            if (numToCompactify <= 0) {
                return messages.slice(-numToPreserve);
            }

            const oldMessages = messages.slice(0, numToCompactify);
            const recentMessages = messages.slice(numToCompactify);

            const compactifiedLines: string[] = [
                '<Compactified Conversation History>',
                `[${numToCompactify} older messages condensed for context efficiency]`,
                ''
            ];

            for (const msg of oldMessages) {
                try {
                    const roleLabel = msg.role === 'assistant' ? 'assistant (you)' : msg.role === 'user' ? 'User' : msg.role;
                    let messageText = '';

                    if (typeof msg.content === 'string') {
                        messageText = msg.content;
                    } else if (Array.isArray(msg.content)) {
                        const textParts = msg.content
                            .filter(item => item.type === 'text')
                            .map(item => item.text)
                            .join(' ');

                        const imageCount = msg.content.filter(item => item.type === 'image_url').length;

                        messageText = textParts;
                        if (imageCount > 0) {
                            messageText += ` [${imageCount} image(s) attached]`;
                        }
                    } else if (msg.content === null || msg.content === undefined) {
                        if (msg.tool_calls && msg.tool_calls.length > 0) {
                            const toolNames = msg.tool_calls
                                .map(tc => {
                                    const func = (tc as any).function;
                                    return func?.name || 'unknown_tool';
                                })
                                .join(', ');
                            messageText = `[Used tools: ${toolNames}]`;
                        } else {
                            messageText = '[Empty message]';
                        }
                    }

                    messageText = this.stripSystemContext(messageText);

                    if (messageText.length > MAX_MESSAGE_LENGTH) {
                        messageText = messageText.substring(0, MAX_MESSAGE_LENGTH) + '...';
                    }

                    messageText = messageText
                        .replace(/\n+/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();

                    if (messageText) {
                        compactifiedLines.push(`${roleLabel}: ${messageText}`);
                    }
                } catch (error) {
                    console.warn('Failed to process message during compactification:', error);
                    compactifiedLines.push(`[Message processing error]`);
                }
            }

            compactifiedLines.push('');
            compactifiedLines.push('---');
            compactifiedLines.push('[Recent conversation continues below in full detail...]');

            const compactifiedMessage: ConversationMessage = {
                role: 'user' as MessageRole,
                content: compactifiedLines.join('\n'),
                conversationId: `compactified-${Date.now()}`
            };

            return [compactifiedMessage, ...recentMessages];
        } catch (error) {
            console.error('Error during context compactification:', error);

            const COMPACTION_THRESHOLD = Math.floor(0.8 * MAX_LLM_MESSAGES);
            if (messages.length >= COMPACTION_THRESHOLD) {
                const safeSubset = Math.ceil(messages.length * 0.4);
                console.warn(`Compactification failed, returning last ${safeSubset} messages as fallback`);
                return messages.slice(-safeSubset);
            }

            return messages;
        }
    }

    async execute(inputs: UserConversationInputs, options: OperationOptions): Promise<UserConversationOutputs> {
        const { env, logger, context, agent } = options;
        const { userMessage, pastMessages, errors, images, projectUpdates } = inputs;

        logger.info("Processing user message", {
            messageLength: inputs.userMessage.length,
            hasImages: !!images && images.length > 0,
            imageCount: images?.length || 0
        });

        try {
            const systemPromptMessages = getSystemPromptWithProjectContext(SYSTEM_PROMPT, context, CodeSerializerType.SIMPLE);

            const userPromptForInference = buildUserMessageWithContext(userMessage, errors, projectUpdates, true);
            const userMessageForInference = images && images.length > 0
                ? createMultiModalUserMessage(
                    userPromptForInference,
                    images.map(img => `data:${img.mimeType};base64,${img.base64Data}`),
                    'high'
                )
                : createUserMessage(userPromptForInference);

            const userPromptForHistory = buildUserMessageWithContext(userMessage, errors, projectUpdates, false);
            const userMessageForHistory = images && images.length > 0
                ? createUserMessage(`${userPromptForHistory}\n\n[${images.length} image(s) attached]`)
                : createUserMessage(userPromptForHistory);

            const messages = [...pastMessages, {...userMessageForHistory, conversationId: IdGenerator.generateConversationId()}];

            let extractedUserResponse = "";
            const aiConversationId = IdGenerator.generateConversationId();

            logger.info("Generated conversation ID", { aiConversationId });

            const tools: ToolDefinition<any, any>[] = [
                ...buildTools(agent, logger)
            ].map(td => ({
                ...td,
                onStart: (args: any) => inputs.conversationResponseCallback(
                    '',
                    aiConversationId,
                    false,
                    { name: td.function.name, status: 'start', args: args as Record<string, unknown> }
                ),
                onComplete: (args: any, _result: any) => inputs.conversationResponseCallback(
                    '',
                    aiConversationId,
                    false,
                    { name: td.function.name, status: 'success', args: args as Record<string, unknown> }
                )
            }));

            const compactifiedMessages = await this.compactifyContext(pastMessages);
            if (compactifiedMessages.length !== pastMessages.length) {
                const numCompactified = pastMessages.length - (compactifiedMessages.length - 1);
                logger.warn("Compactified conversation history", {
                    originalLength: pastMessages.length,
                    compactifiedLength: compactifiedMessages.length,
                    numOldMessagesCompacted: numCompactified,
                    threshold: `${Math.floor(0.8 * MAX_LLM_MESSAGES)} messages`
                });
            }

            logger.info("Executing inference for user message", {
                messageLength: userMessage.length,
                aiConversationId
            });

            const result = await executeInference({
                env: env,
                messages: [...systemPromptMessages, ...compactifiedMessages, {...userMessageForInference, conversationId: IdGenerator.generateConversationId()}],
                agentActionName: "conversationalResponse",
                context: options.inferenceContext,
                tools,
                stream: {
                    onChunk: (chunk) => {
                        logger.info("Processing user message chunk", { chunkLength: chunk.length, aiConversationId });
                        inputs.conversationResponseCallback(chunk, aiConversationId, true);
                        extractedUserResponse += chunk;
                    },
                    chunk_size: CHUNK_SIZE
                }
            });

            logger.info("Successfully processed user message", {
                streamingSuccess: !!extractedUserResponse,
            });

            const conversationResponse: ConversationalResponseType = {
                userResponse: extractedUserResponse
            };

            if (result.toolCallContext?.messages && result.toolCallContext.messages.length > 0) {
                messages.push(
                    ...result.toolCallContext.messages
                        .filter((message) => !(message.role === 'assistant' && typeof(message.content) === 'string' && message.content.includes('Internal Memo')))
                        .map((message) => ({ ...message, conversationId: IdGenerator.generateConversationId() }))
                );
            }
            messages.push({...createAssistantMessage(result.string), conversationId: IdGenerator.generateConversationId()});

            logger.info("Current conversation history", { messageCount: messages.length });

            return {
                conversationResponse,
                messages: messages
            };
        } catch (error) {
            logger.error("Error processing user message:", error);
            if (error instanceof RateLimitExceededError || error instanceof SecurityError) {
                throw error;
            }

            return {
                conversationResponse: {
                    userResponse: FALLBACK_USER_RESPONSE
                },
                messages: [
                    ...pastMessages,
                    {...createUserMessage(userMessage), conversationId: IdGenerator.generateConversationId()},
                    {...createAssistantMessage(FALLBACK_USER_RESPONSE), conversationId: IdGenerator.generateConversationId()}
                ]
            };
        }
    }

    processProjectUpdates<T extends ProjectUpdateType>(updateType: T, _data: WebSocketMessageData<T>, logger: StructuredLogger) : ConversationMessage[] {
        try {
            logger.info("Processing project update", { updateType });

            const preparedMessage = `**<Internal Memo>**
Project Updates: ${updateType}
</Internal Memo>`;

            return [{
                role: 'assistant',
                content: preparedMessage,
                conversationId: IdGenerator.generateConversationId()
            }];
        } catch (error) {
            logger.error("Error processing project update:", error);
            return [];
        }
    }

    isProjectUpdateType(type: any): type is ProjectUpdateType {
        return RelevantProjectUpdateWebsoketMessages.includes(type);
    }
}
