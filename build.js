const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, 'dist');
const CLEAN_BUILD = process.argv.includes('--clean');

// Files and directories to copy
const COPY_PATTERNS = [
    'server.js',
    'database.js',
    'create_admin.js',
    'package.json',
    'package-lock.json',
    'public',
    'uploads'
];

// Directories to create
const DIRS_TO_CREATE = [
    'uploads/stored_files',
    'uploads/resident_docs',
    'uploads/staff_files',
    'uploads/invitations',
    'uploads/protocols',
    'backups'
];

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`✓ Created directory: ${dirPath}`);
    }
}

function copyFile(src, dest) {
    const destDir = path.dirname(dest);
    ensureDir(destDir);
    fs.copyFileSync(src, dest);
    console.log(`✓ Copied: ${path.relative(__dirname, src)} → ${path.relative(__dirname, dest)}`);
}

function copyDir(src, dest) {
    ensureDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            copyFile(srcPath, destPath);
        }
    }
}

function cleanBuild() {
    if (fs.existsSync(BUILD_DIR)) {
        console.log('🧹 Cleaning build directory...');
        fs.rmSync(BUILD_DIR, { recursive: true, force: true });
        console.log('✓ Build directory cleaned');
    }
}

function build() {
    console.log('🚀 Starting build process...\n');
    
    if (CLEAN_BUILD || !fs.existsSync(BUILD_DIR)) {
        cleanBuild();
    }
    
    ensureDir(BUILD_DIR);
    
    // Copy files and directories
    console.log('\n📦 Copying files...');
    for (const pattern of COPY_PATTERNS) {
        const src = path.join(__dirname, pattern);
        const dest = path.join(BUILD_DIR, pattern);
        
        if (!fs.existsSync(src)) {
            console.log(`⚠ Warning: ${pattern} not found, skipping...`);
            continue;
        }
        
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
            copyDir(src, dest);
        } else {
            copyFile(src, dest);
        }
    }
    
    // Create necessary directories
    console.log('\n📁 Creating directories...');
    for (const dir of DIRS_TO_CREATE) {
        ensureDir(path.join(BUILD_DIR, dir));
    }
    
    // Create .gitkeep files for empty directories
    const gitkeepDirs = [
        'uploads/stored_files',
        'uploads/resident_docs',
        'uploads/staff_files',
        'uploads/invitations',
        'uploads/protocols',
        'backups'
    ];
    
    for (const dir of gitkeepDirs) {
        const gitkeepPath = path.join(BUILD_DIR, dir, '.gitkeep');
        if (!fs.existsSync(gitkeepPath)) {
            fs.writeFileSync(gitkeepPath, '');
        }
    }
    
    // Create production package.json (remove dev dependencies if any)
    console.log('\n📝 Creating production package.json...');
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    delete packageJson.devDependencies;
    // Keep only production scripts
    packageJson.scripts = {
        start: "node server.js",
        "start:prod": "cross-env NODE_ENV=production node server.js"
    };
    fs.writeFileSync(
        path.join(BUILD_DIR, 'package.json'),
        JSON.stringify(packageJson, null, 2)
    );
    console.log('✓ Production package.json created');
    
    // Create README for build
    const readmeContent = `# CRM System - Production Build

This is a production build of the CRM system.

## Installation

1. Install dependencies:
   \`\`\`bash
   npm install --production
   \`\`\`

2. Run the server:
   \`\`\`bash
   npm start
   \`\`\`

Or for production mode:
   \`\`\`bash
   npm run start:prod
   \`\`\`

## Initial Setup

Run the admin creation script:
\`\`\`bash
node create_admin.js
\`\`\`

## Notes

- Database files (users.db, projects.db, meetings.db) will be created automatically
- Upload directories are pre-created
- Backups directory is ready for scheduled backups
`;

    fs.writeFileSync(path.join(BUILD_DIR, 'README.md'), readmeContent);
    console.log('✓ README.md created');
    
    console.log('\n✅ Build completed successfully!');
    console.log(`📦 Build output: ${BUILD_DIR}`);
    console.log('\nTo deploy:');
    console.log(`  1. cd ${BUILD_DIR}`);
    console.log('  2. npm install --production');
    console.log('  3. npm start');
}

// Run build
try {
    build();
} catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
}

