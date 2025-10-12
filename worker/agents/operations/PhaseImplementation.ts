import { PhaseConceptType, FileOutputType, PhaseConceptSchema } from '../schemas';
import { IssueReport } from '../domain/values/IssueReport';
import { createUserMessage, createMultiModalUserMessage } from '../inferutils/common';
import { executeInference } from '../inferutils/infer';
import { issuesPromptFormatter, PROMPT_UTILS, STRATEGIES } from '../prompts';
import { CodeGenerationStreamingState } from '../output-formats/streaming-formats/base';
import { FileProcessing } from '../domain/pure/FileProcessing';
import { AgentOperation, getSystemPromptWithProjectContext, OperationOptions } from '../operations/common';
import { SCOFFormat, SCOFParsingState } from '../output-formats/streaming-formats/scof';
import { TemplateRegistry } from '../inferutils/schemaFormatters';
import { IsRealtimeCodeFixerEnabled, RealtimeCodeFixer } from '../assistants/realtimeCodeFixer';
import { AGENT_CONFIG } from '../inferutils/config';
import { CodeSerializerType } from '../utils/codeSerializers';
import type { UserContext } from '../core/types';
import { getImageUrlGuidance } from '../utils/imageUrlValidator';

export interface PhaseImplementationInputs {
    phase: PhaseConceptType
    issues: IssueReport
    isFirstPhase: boolean
    shouldAutoFix: boolean
    userContext?: UserContext;
    fileGeneratingCallback: (filePath: string, filePurpose: string) => void
    fileChunkGeneratedCallback: (filePath: string, chunk: string, format: 'full_content' | 'unified_diff') => void
    fileClosedCallback: (file: FileOutputType, message: string) => void
}

export interface PhaseImplementationOutputs{
    fixedFilePromises: Promise<FileOutputType>[]
    deploymentNeeded: boolean
    commands: string[]
}

export const SYSTEM_PROMPT = `<CRITICAL_CONTEXT>
You implement code phases for a production system. Each phase MUST be:
1. Deployable (zero runtime errors)
2. Visually polished (professional UI)
3. Backward compatible (no regressions)

SUCCESS CRITERIA: App runs without errors + UI looks professional + All phase requirements met
FAILURE MODES: Render loops, undefined errors, import failures, broken layouts
</CRITICAL_CONTEXT>

<ROLE>
You are an Expert Senior Full-Stack Engineer at Google, renowned for crafting high-performance, visually stunning, robust, and maintainable web applications.
You work on a special rapid development team that delivers exceptionally beautiful, high quality projects that users love to interact with.
</ROLE>

<ZERO_TOLERANCE_RULES>
These patterns CRASH the app. Check EVERY file before submitting:

1. ZUSTAND SELECTOR CRASHES (Most common bug):
   ❌ const {a,b} = useStore(s => ({a: s.a, b: s.b}))  // NO useShallow = CRASH
   ❌ const items = useStore(s => s.getItems())        // Returns new array = CRASH
   ❌ const {a,b} = useStore()                         // No selector = returns whole state

   ✅ const a = useStore(s => s.a); const b = useStore(s => s.b);  // SAFE - use this by default
   ✅ const {a,b} = useStore(useShallow(s => ({a: s.a, b: s.b})));  // SAFE if useShallow imported

   WHY: Object-literal selectors create NEW objects every render = infinite loop
   VALIDATION: Search code for "useStore(s => ({" - if found WITHOUT useShallow, REWRITE immediately

2. REACT RENDER LOOPS:
   ❌ useEffect(() => setState(x))                    // No deps = infinite loop
   ❌ setState during render phase                     // Crashes immediately
   ❌ useEffect with unstable dependencies            // Object/array literals in deps

   ✅ useEffect(() => setState(x), [dependency])      // Properly controlled
   ✅ const stableRef = useMemo(() => ({...}), [])    // Stabilize objects
   ✅ Store actions are stable - exclude from deps

3. UNDEFINED ACCESS:
   ❌ data.items.length                                // Crashes if data undefined
   ❌ user.profile.name                                // Crashes if user or profile undefined

   ✅ data?.items?.length ?? 0                         // Safe with fallback
   ✅ user?.profile?.name || 'Guest'                   // Safe with default

4. IMPORT FAILURES:
   ❌ import { X } from './nonexistent'                // Build fails
   ❌ import X from '@xyflow/react'                    // Wrong - should be named import
   ❌ Using packages not in <DEPENDENCIES>             // Will fail at runtime

   ✅ Verify EVERY import against <DEPENDENCIES>
   ✅ Check named vs default import syntax
   ✅ Confirm file paths exist or are being created

VALIDATION CHECKLIST (Run mentally before submitting ANY .tsx file):
□ No "useStore(s => ({" without useShallow wrapper
□ No useStore selecting methods/getters that return arrays/objects
□ All useEffect hooks have dependency arrays
□ All data property access uses ?. optional chaining
□ All imports verified against <DEPENDENCIES> section
□ No setState calls during render phase
□ All file paths in imports exist or are being created this phase
</ZERO_TOLERANCE_RULES>

<LAYOUT_ARCHITECTURE_PATTERNS>
Use these proven patterns - copy them exactly:

1. Full-height page layout:
\`\`\`tsx
<div className="h-screen flex flex-col">
    <header className="flex-shrink-0">...</header>
    <main className="flex-1 overflow-auto">...</main>
</div>
\`\`\`

2. Sidebar + main layout:
\`\`\`tsx
<div className="h-full flex">
    <aside className="w-64 min-w-[180px] flex-shrink-0">...</aside>
    <main className="flex-1 overflow-auto">...</main>
</div>
\`\`\`

3. Resizable panels:
\`\`\`tsx
<ResizablePanelGroup direction="horizontal" className="h-full">
    <ResizablePanel defaultSize={25}>
        <aside className="h-full min-w-[180px]">...</aside>
    </ResizablePanel>
    <ResizableHandle withHandle />
    <ResizablePanel defaultSize={75}>
        <main className="h-full overflow-auto">...</main>
    </ResizablePanel>
</ResizablePanelGroup>
\`\`\`

4. Data-driven rendering (always guard):
\`\`\`tsx
if (isLoading) return <LoadingSkeleton />;
if (error) return <ErrorState message={error} />;
if (!items?.length) return <EmptyState />;
return <List items={items} />;
\`\`\`
</LAYOUT_ARCHITECTURE_PATTERNS>

${PROMPT_UTILS.UI_GUIDELINES}

${STRATEGIES.FRONTEND_FIRST_CODING}

${PROMPT_UTILS.REACT_RENDER_LOOP_PREVENTION}

<IMPLEMENTATION_STANDARDS>
**Critical Error Prevention (Fix These First):**
1. Variable Declaration Order - Declare ALL variables before use (avoid TDZ errors)
2. Null Safety - Add guards before property access: user?.name
3. Async Error Handling - Wrap in try-catch with error state
4. Type Safety - Prefer proper types over 'as' casting

**Code Quality Standards:**
• Robustness: Fault-tolerant with proper error handling and fallbacks
• State Management: Correct state updates, no infinite re-renders, no stale closures
• Performance: Use React.memo, useMemo, useCallback to prevent unnecessary re-renders
• Visual Excellence: Stunning, professional-grade UI with perfect spacing, smooth animations, responsive layouts
• Dependency Verification: ONLY use libraries in <DEPENDENCIES> - no others exist
• Bug-Free Code: Highest standards with correct syntax and valid imports
• DRY Principles: Research codebase patterns, understand before changing, be efficient

**Visual Polish Checklist (For Every Component):**
□ Beautiful hover and focus states
□ Clear visual hierarchy and information flow
□ Consistent, harmonious spacing rhythm
□ Professional shadows, borders, visual depth
□ Smooth transitions and micro-interactions
□ Intentional responsive behavior at all screen sizes
□ Accessible design with proper contrast

**Phase Completion Requirements:**
• Every file listed in <CURRENT_PHASE> must be implemented
• Write full file contents (full_content format) - not diffs
• Ensure entire codebase is correct and working
• If first phase, override template boilerplate with actual application
• Product must be FUNCTIONAL, POLISHED, AND VISUALLY STUNNING
</IMPLEMENTATION_STANDARDS>

${getImageUrlGuidance()}

<COMMON_PITFALLS_TO_AVOID>
${PROMPT_UTILS.COMMON_PITFALLS}
</COMMON_PITFALLS_TO_AVOID>

${PROMPT_UTILS.COMMON_DEP_DOCUMENTATION}

<CLIENT_REQUEST>
"{{query}}"
</CLIENT_REQUEST>

<BLUEPRINT>
{{blueprint}}
</BLUEPRINT>

<DEPENDENCIES>
**Available Dependencies:**

Installed packages:
{{dependencies}}

Additional frameworks (if provided):
{{blueprintDependencies}}

These are the ONLY dependencies available. No other packages exist.
</DEPENDENCIES>

{{template}}`;

const USER_PROMPT = `**Phase Implementation**

<INSTRUCTIONS>
Implement this phase following all <ZERO_TOLERANCE_RULES> and <IMPLEMENTATION_STANDARDS>.

**Pre-Implementation Checklist:**
1. Review <CURRENT_PHASE> files and requirements
2. Check <REPORTED_ISSUES> for critical errors to fix first
3. Review current codebase to understand existing patterns
4. Verify all imports against <DEPENDENCIES>
5. Plan file generation order (dependencies first)

**Implementation Protocol:**
• If runtime errors exist: FIX THEM FIRST before adding features
• Critical error priority: Render loops → Undefined access → Import errors → Logic bugs
• Implement all files listed in <CURRENT_PHASE>
• Maintain backward compatibility with previous phases
• Ensure UI is visually polished, not placeholder quality
• Write full file contents (full_content format)

**Post-Implementation Validation:**
Before submitting each .tsx file, verify:
□ No zustand selector anti-patterns
□ All useEffect have dependency arrays
□ All data access has optional chaining
□ All imports are valid and in <DEPENDENCIES>
□ No setState during render phase
□ Component is exported correctly
</INSTRUCTIONS>

<CURRENT_PHASE>
{{phaseText}}

{{issues}}

{{userSuggestions}}
</CURRENT_PHASE>`;

const LAST_PHASE_PROMPT = `**Finalization and Review Phase**

<REVIEW_PROTOCOL>
Your goal: Find and fix showstopper bugs before deployment.

**Priority Order:**
1. Runtime Errors & Crashes - Code that will throw errors
2. Critical Logic Flaws - Behavior not matching blueprint
3. UI Rendering Failures - Broken layouts, missing elements
4. State Management Bugs - Incorrect updates, race conditions
5. Import/Dependency Issues - Invalid imports, wrong versions

**Review Method:**
• Scan file-by-file, considering dependencies
• Mentally simulate user flows from blueprint
• Cross-reference against blueprint constantly
• Pay extreme attention to declaration order
• Focus on deployment-blocking issues only

**When to Regenerate Files:**
✓ Critical issues causing runtime errors
✓ Significant logic flaws
✓ Major rendering failures
✓ Small UI/CSS files for styling fixes

✗ Do NOT regenerate for:
  • Minor formatting preferences
  • Non-critical stylistic changes
  • Major refactors (not allowed in review phase)

IF runtime errors exist: Focus ONLY on fixing them. Ignore minor issues.
This phase prepares code for final deployment - focus on stability.
</REVIEW_PROTOCOL>

{{issues}}`;

const README_GENERATION_PROMPT = `<TASK>
Generate a comprehensive README.md file for this project.
</TASK>

<REQUIREMENTS>
• Professional markdown formatting
• No images or screenshots
• Project title, description, key features from blueprint
• Technology stack from template dependencies
• Setup instructions using bun (not npm/yarn)
• Usage examples and development instructions
• Deployment section with Cloudflare-specific instructions
• Add [cloudflarebutton] placeholder (exact string, no backticks) at top and in deployment section
• Clear structure with appropriate headers
• Concise but comprehensive
• Professional tone for open source

Output only raw markdown - no explanations, no code fences.
</REQUIREMENTS>`;

const formatUserSuggestions = (suggestions?: string[] | null): string => {
    if (!suggestions || suggestions.length === 0) return '';

    return `
<USER_SUGGESTIONS>
Client feedback and suggestions (from conversation agent):

${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}

**IMPORTANT**: Resolve these elegantly and non-hackily. May implement across multiple phases as needed.
</USER_SUGGESTIONS>`;
};

const specialPhasePromptOverrides: Record<string, string> = {
    "Finalization and Review": LAST_PHASE_PROMPT,
}

const userPromptFormatter = (phaseConcept: PhaseConceptType, issues: IssueReport, userSuggestions?: string[]) => {
    const phaseText = TemplateRegistry.markdown.serialize(phaseConcept, PhaseConceptSchema);
    const basePrompt = specialPhasePromptOverrides[phaseConcept.name] || USER_PROMPT;

    const prompt = PROMPT_UTILS.replaceTemplateVariables(basePrompt, {
        phaseText,
        issues: issuesPromptFormatter(issues),
        userSuggestions: formatUserSuggestions(userSuggestions)
    });
    return PROMPT_UTILS.verifyPrompt(prompt);
}

export class PhaseImplementationOperation extends AgentOperation<PhaseImplementationInputs, PhaseImplementationOutputs> {
    async execute(
        inputs: PhaseImplementationInputs,
        options: OperationOptions
    ): Promise<PhaseImplementationOutputs> {
        const { phase, issues, userContext } = inputs;
        const { env, logger, context } = options;

        logger.info(`Generating files for phase: ${phase.name}`, phase.description, "files:", phase.files.map(f => f.path));

        const codeGenerationFormat = new SCOFFormat();
        const messages = getSystemPromptWithProjectContext(SYSTEM_PROMPT, context, CodeSerializerType.SCOF);

        const userPrompt = userPromptFormatter(phase, issues, userContext?.suggestions) + codeGenerationFormat.formatInstructions();
        const userMessage = userContext?.images && userContext.images.length > 0
            ? createMultiModalUserMessage(
                userPrompt,
                userContext.images.map(img => `data:${img.mimeType};base64,${img.base64Data}`),
                'high'
            )
            : createUserMessage(userPrompt);

        messages.push(userMessage);

        const streamingState: CodeGenerationStreamingState = {
            accumulator: '',
            completedFiles: new Map(),
            parsingState: {} as SCOFParsingState
        };

        const fixedFilePromises: Promise<FileOutputType>[] = [];

        let modelConfig = AGENT_CONFIG.phaseImplementation;
        if (inputs.isFirstPhase) {
            modelConfig = AGENT_CONFIG.firstPhaseImplementation;
        }

        const shouldEnableRealtimeCodeFixer = inputs.shouldAutoFix && IsRealtimeCodeFixerEnabled(options.inferenceContext);

        await executeInference({
            env: env,
            agentActionName: "phaseImplementation",
            context: options.inferenceContext,
            messages,
            modelConfig,
            stream: {
                chunk_size: 256,
                onChunk: (chunk: string) => {
                    codeGenerationFormat.parseStreamingChunks(
                        chunk,
                        streamingState,
                        (filePath: string) => {
                            logger.info(`Starting generation of file: ${filePath}`);
                            inputs.fileGeneratingCallback(filePath, FileProcessing.findFilePurpose(filePath, phase, context.allFiles.reduce((acc, f) => ({ ...acc, [f.filePath]: f }), {})));
                        },
                        (filePath: string, fileChunk: string, format: 'full_content' | 'unified_diff') => {
                            inputs.fileChunkGeneratedCallback(filePath, fileChunk, format);
                        },
                        (filePath: string) => {
                            logger.info(`Completed generation of file: ${filePath}`);
                            const completedFile = streamingState.completedFiles.get(filePath);
                            if (!completedFile) {
                                logger.error(`Completed file not found: ${filePath}`);
                                return;
                            }

                            const originalContents = context.allFiles.find(f => f.filePath === filePath)?.fileContents || '';
                            completedFile.fileContents = FileProcessing.processGeneratedFileContents(
                                completedFile,
                                originalContents,
                                logger
                            );

                            const generatedFile: FileOutputType = {
                                ...completedFile,
                                filePurpose: FileProcessing.findFilePurpose(
                                    filePath,
                                    phase,
                                    context.allFiles.reduce((acc, f) => ({ ...acc, [f.filePath]: f }), {})
                                )
                            };

                            if (shouldEnableRealtimeCodeFixer && generatedFile.fileContents.split('\n').length > 50) {
                                const realtimeCodeFixer = new RealtimeCodeFixer(env, options.inferenceContext);
                                const fixPromise = realtimeCodeFixer.run(
                                    generatedFile,
                                    {
                                        query: context.query,
                                        template: context.templateDetails
                                    },
                                    phase
                                );
                                fixedFilePromises.push(fixPromise);
                            } else {
                                fixedFilePromises.push(Promise.resolve(generatedFile));
                            }

                            inputs.fileClosedCallback(generatedFile, `Completed generation of ${filePath}`);
                        }
                    );
                }
            }
        });

        const commands = streamingState.parsingState.extractedInstallCommands;

        logger.info("Files generated for phase:", phase.name, "with", fixedFilePromises.length, "files being fixed in real-time and extracted install commands:", commands);

        return {
            fixedFilePromises,
            deploymentNeeded: fixedFilePromises.length > 0,
            commands,
        };
    }

    async generateReadme(options: OperationOptions): Promise<FileOutputType> {
        const { env, logger, context } = options;
        logger.info("Generating README.md for the project");

        try {
            const messages = [...getSystemPromptWithProjectContext(SYSTEM_PROMPT, context, CodeSerializerType.SCOF), createUserMessage(README_GENERATION_PROMPT)];

            const results = await executeInference({
                env: env,
                messages,
                agentActionName: "projectSetup",
                context: options.inferenceContext,
            });

            if (!results || !results.string) {
                logger.error('Failed to generate README.md content');
                throw new Error('Failed to generate README.md content');
            }

            logger.info('Generated README.md content successfully');

            return {
                filePath: 'README.md',
                fileContents: results.string,
                filePurpose: 'Project documentation and setup instructions'
            };
        } catch (error) {
            logger.error("Error generating README:", error);
            throw error;
        }
    }
}
