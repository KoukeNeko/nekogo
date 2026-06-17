/**
 * scripts/verify-kanjivg.ts
 * Harness script to verify that we can fetch and parse KanjiVG paths.
 */

async function fetchKanjiVG(kanji: string) {
    // Convert Kanji to its 5-digit hex unicode representation
    const code = kanji.charCodeAt(0).toString(16).padStart(5, '0');
    const url = `https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/${code}.svg`;
    
    console.log(`Fetching SVG for '${kanji}' (Unicode: ${code}) from:\\n${url}\\n`);
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        }
        
        const svgText = await response.text();
        
        // Use a simple regex to extract the "d" attributes from all <path> tags
        // KanjiVG paths contain the stroke data in the 'd' attribute
        const pathRegex = /<path[^>]*d="([^"]+)"/g;
        const paths: string[] = [];
        let match;
        
        while ((match = pathRegex.exec(svgText)) !== null) {
            paths.push(match[1]);
        }
        
        console.log(`✅ Successfully extracted ${paths.length} strokes for '${kanji}'.`);
        console.log('--- Paths ---');
        paths.forEach((p, i) => {
            console.log(`Stroke ${i + 1}: ${p.substring(0, 30)}...`);
        });
        console.log('-------------\\n');
        
        if (paths.length === 0) {
            throw new Error("No paths were extracted from the SVG.");
        }
        
        return paths;
    } catch (error) {
        throw error;
    }
}

async function runHarness() {
    console.log('--- KanjiVG Parsing Verification ---\\n');
    await fetchKanjiVG('木');
    console.log('Harness verification complete.');
}

runHarness();
