/**
 * SEO Guidance for Generated Web Applications
 *
 * Provides comprehensive SEO instructions for LLMs to generate properly optimized
 * web applications with appropriate meta tags, Open Graph data, and structured data.
 */

/**
 * Returns comprehensive SEO guidance to be included in LLM system prompts
 */
export function getSeoGuidance(): string {
    return `
<SEO_REQUIREMENTS>
**CRITICAL: Every generated web application MUST include comprehensive SEO meta tags in index.html**

## Required SEO Elements

### 1. Basic Meta Tags (MANDATORY)
Every index.html MUST include:

\`\`\`html
<!-- Basic Meta Tags -->
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />

<!-- SEO Meta Tags -->
<title>[App Name] | [Short Description]</title>
<meta name="description" content="[150-160 character description of what the app does]" />
<meta name="keywords" content="[5-10 relevant keywords, comma-separated]" />
<meta name="author" content="Built with AIWA" />
<meta name="theme-color" content="[primary-color-from-design]" />
\`\`\`

### 2. Open Graph Tags (MANDATORY)
For social media sharing - MUST be included:

\`\`\`html
<!-- Open Graph / Facebook -->
<meta property="og:type" content="website" />
<meta property="og:title" content="[App Name] | [Short Description]" />
<meta property="og:description" content="[Description of the app - what it does, who it's for]" />
<meta property="og:image" content="https://picsum.photos/1200/630?random=[unique-id]" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:site_name" content="[App Name]" />
\`\`\`

**IMPORTANT for og:image**:
- Use Picsum (https://picsum.photos/) for placeholder images
- Format: \`https://picsum.photos/1200/630?random=[unique-number]\`
- Dimensions: 1200x630 (optimal for social media)
- Add unique random parameter to ensure different images

### 3. Twitter Card Tags (MANDATORY)
For Twitter/X sharing - MUST be included:

\`\`\`html
<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="[App Name] | [Short Description]" />
<meta name="twitter:description" content="[Same as OG description]" />
<meta name="twitter:image" content="https://picsum.photos/1200/630?random=[same-as-og]" />
\`\`\`

### 4. Favicons (RECOMMENDED)
Include favicon references (even if using placeholders):

\`\`\`html
<!-- Favicons -->
<link rel="icon" type="image/x-icon" href="/favicon.ico" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
\`\`\`

## SEO Content Guidelines

### Title Tag Best Practices:
- Format: \`[App Name] | [Value Proposition]\`
- Length: 50-60 characters (Google displays ~60)
- Include primary keyword naturally
- Make it compelling and click-worthy

**Examples:**
- Game: "2048 Puzzle | Classic Number Matching Game"
- Productivity: "TaskFlow | Simple Daily Task Manager"
- Creative: "Color Palette Generator | Design Tool"
- Business: "Invoice Creator | Free Online Invoicing"

### Description Meta Tag Best Practices:
- Length: 150-160 characters (Google displays ~160)
- Include primary and secondary keywords naturally
- Describe what the app does and who it's for
- Include a call-to-action if appropriate
- Make it compelling for search results

**Examples:**
- "Create beautiful task lists and boost productivity. Simple, fast, and free daily task manager for individuals and teams."
- "Play the addictive 2048 number puzzle game. Combine tiles to reach 2048. Free online game, no download required."
- "Generate perfect color palettes for your designs. Create, customize, and export color schemes instantly. Free design tool."

### Keywords Meta Tag Guidelines:
- 5-10 highly relevant keywords
- Mix of broad and specific terms
- Include primary app function
- Include target audience terms
- Comma-separated list

**Examples:**
- Task app: "task manager, to-do list, productivity, daily planner, task tracker"
- Game: "puzzle game, 2048, number game, brain game, casual game"
- Design tool: "color palette, design tool, color generator, color scheme, web design"

## Image URL Requirements for SEO

### Social Media Images (og:image, twitter:image):
**ALWAYS use Picsum for reliable placeholder images:**
- ✅ CORRECT: \`https://picsum.photos/1200/630?random=1234\`
- ✅ CORRECT: \`https://picsum.photos/1200/630?random=\${Date.now()}\`
- ❌ WRONG: \`https://images.unsplash.com/...\` (unreliable, breaks frequently)
- ❌ WRONG: \`/og-image.png\` without creating the actual file

**Best practices:**
- Use 1200x630 dimensions (optimal for all platforms)
- Add unique random parameter
- Same image for both og:image and twitter:image
- Consider the app theme when choosing random seed

## Implementation Checklist

When generating index.html for ANY web application:

□ Include all required meta tags in <head>
□ Set appropriate title with app name and value proposition
□ Write compelling 150-160 character description
□ Add 5-10 relevant keywords
□ Include complete Open Graph tags with Picsum image
□ Include complete Twitter Card tags with same image
□ Set theme-color to match app's primary color
□ Add favicon references
□ Use proper character encoding (UTF-8)
□ Include viewport meta for mobile responsiveness

## Common Mistakes to Avoid

❌ **DON'T:**
- Skip SEO tags entirely
- Use generic titles like "My App" or "React App"
- Write descriptions over 160 characters
- Use Unsplash URLs for social images (they break)
- Forget Open Graph tags
- Use relative URLs for og:image (must be absolute)
- Leave placeholder text like "[App Name]" in production

✅ **DO:**
- Include ALL required SEO tags
- Write specific, keyword-rich titles
- Keep descriptions concise and compelling
- Use Picsum for reliable placeholder images
- Include both OG and Twitter tags
- Use absolute URLs for all image references
- Customize all content based on the actual app

## Example: Complete SEO Implementation

Here's a perfect example for a Todo List app:

\`\`\`html
<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />

    <!-- Basic SEO -->
    <title>TaskFlow | Simple Daily Task Manager</title>
    <meta name="description" content="Organize your day with TaskFlow. Create, manage, and complete tasks efficiently. Free, simple, and beautiful task management for everyone." />
    <meta name="keywords" content="task manager, to-do list, productivity app, daily planner, task organizer" />
    <meta name="author" content="Built with AIWA" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:title" content="TaskFlow | Simple Daily Task Manager" />
    <meta property="og:description" content="Organize your day with TaskFlow. Create, manage, and complete tasks efficiently. Free task management for everyone." />
    <meta property="og:image" content="https://picsum.photos/1200/630?random=12345" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:site_name" content="TaskFlow" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="TaskFlow | Simple Daily Task Manager" />
    <meta name="twitter:description" content="Organize your day with TaskFlow. Create, manage, and complete tasks efficiently." />
    <meta name="twitter:image" content="https://picsum.photos/1200/630?random=12345" />

    <!-- Favicons -->
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />

    <!-- Theme Color -->
    <meta name="theme-color" content="#3b82f6" />
</head>
<body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
</body>
</html>
\`\`\`

## Why SEO Matters for Generated Apps

1. **Discoverability**: Proper SEO helps users find the app through search engines
2. **Social Sharing**: OG/Twitter tags ensure beautiful previews when shared
3. **Professionalism**: Complete meta tags show attention to detail
4. **User Trust**: Proper descriptions help users understand what the app does
5. **Mobile Experience**: Viewport and theme-color improve mobile UX

**Remember**: SEO is not optional. Every generated app should be production-ready with complete SEO optimization.

</SEO_REQUIREMENTS>`;
}

/**
 * Generates app-specific SEO content based on app details
 * Can be used to provide tailored examples in prompts
 */
export interface SeoContent {
    title: string;
    description: string;
    keywords: string[];
    ogImageUrl: string;
    themeColor: string;
}

export function generateSeoSuggestions(
    appName: string,
    appDescription: string,
    appType: 'game' | 'productivity' | 'creative' | 'business' | 'social' | 'other' = 'other'
): SeoContent {
    // Generate unique random seed for image
    const randomSeed = Math.floor(Math.random() * 1000000);

    // Determine theme color based on app type
    const themeColors: Record<typeof appType, string> = {
        game: '#8b5cf6',      // purple
        productivity: '#3b82f6', // blue
        creative: '#ec4899',   // pink
        business: '#10b981',   // green
        social: '#f59e0b',     // orange
        other: '#6366f1'       // indigo
    };

    // Generate concise title (under 60 chars)
    let title = appName;
    if (appDescription && title.length < 40) {
        const shortDesc = appDescription.split('.')[0].slice(0, 50);
        title = `${appName} | ${shortDesc}`;
    }
    if (title.length > 60) {
        title = title.slice(0, 57) + '...';
    }

    // Generate description (150-160 chars)
    let description = appDescription || `Discover ${appName} - a modern web application built for your needs.`;
    if (description.length > 160) {
        description = description.slice(0, 157) + '...';
    }

    // Generate relevant keywords based on app type
    const typeKeywords: Record<typeof appType, string[]> = {
        game: ['game', 'play online', 'browser game', 'free game'],
        productivity: ['productivity', 'tool', 'organize', 'manage'],
        creative: ['design', 'creative', 'tool', 'generator'],
        business: ['business', 'professional', 'enterprise', 'tool'],
        social: ['social', 'community', 'connect', 'share'],
        other: ['web app', 'online tool', 'free', 'easy to use']
    };

    const keywords = [
        appName.toLowerCase(),
        ...typeKeywords[appType],
        'web application',
        'online'
    ].slice(0, 10);

    return {
        title,
        description,
        keywords,
        ogImageUrl: `https://picsum.photos/1200/630?random=${randomSeed}`,
        themeColor: themeColors[appType]
    };
}
