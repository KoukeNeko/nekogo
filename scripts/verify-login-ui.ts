import * as fs from 'fs';
import * as path from 'path';

function verifyLoginUI() {
    const filePath = path.join(__dirname, '../src/app/login.tsx');
    if (!fs.existsSync(filePath)) {
        console.error('❌ Failed: login.tsx does not exist.');
        process.exit(1);
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    const requiredImports = [
        '@expo/vector-icons',
        'lucide-react-native',
        'SafeAreaView',
        'Colors',
    ];

    let passed = true;
    for (const req of requiredImports) {
        if (!content.includes(req)) {
            console.error(`❌ Failed: login.tsx is missing required import or keyword: ${req}`);
            passed = false;
        }
    }

    const requiredElements = [
        'Apple',
        'Google',
        'Kioku',
        '記憶',
        '職人品質',
    ];

    for (const req of requiredElements) {
        if (!content.includes(req)) {
            console.error(`❌ Failed: login.tsx is missing required element text: ${req}`);
            passed = false;
        }
    }

    if (passed) {
        console.log('✅ Success: login.tsx passes basic UI harness verification.');
    } else {
        process.exit(1);
    }
}

verifyLoginUI();
