/**
 * Predefined ignore pattern presets for different project types
 * These can be used to quickly configure ~/.knox/.knoxignore
 */

import { getGlobalKnoxIgnorePath } from 'core/util/paths';
import {
    detectCheckpointPresetKind,
    LINUX_KERNEL_IGNORE_PATTERNS,
    QEMU_IGNORE_PATTERNS,
} from 'core/util/checkpointIgnore';

export interface IgnorePreset {
    name: string;
    description: string;
    patterns: string[];
}

/**
 * Common patterns used across all project types
 */
export const COMMON_PATTERNS: string[] = [
    '# Version Control',
    '.git/',
    '.svn/',
    '.hg/',
    '',
    '# Knox Internal',
    '.knox/',
    '.knox-debug/',
    '',
    '# Secrets (un-ignore in .knoxignore if you truly need them checkpointed)',
    '.env',
    '.env.*',
    '*.pem',
    '*.key',
    'id_rsa',
    'id_ed25519',
    'credentials.json',
    '*.p12',
    '*.pfx',
    '.npmrc',
    '.pypirc',
    'secrets.*',
    '*.keystore',
    '',
    '# IDE & Editor',
    '.vscode/',
    '.idea/',
    '*.swp',
    '*.swo',
    '*~',
    '.DS_Store',
    '',
    '# Logs & Temporary Files',
    '*.log',
    '*.tmp',
    '*.temp',
    '*.bak',
    '*.cache',
    '',
];

/**
 * Preset for Node.js / JavaScript / TypeScript projects
 */
export const NODE_PRESET: IgnorePreset = {
    name: 'Node.js / TypeScript',
    description: 'For JavaScript, TypeScript, Node.js, React, Vue, Angular projects',
    patterns: [
        ...COMMON_PATTERNS,
        '# Dependencies',
        'node_modules/',
        'bower_components/',
        'jspm_packages/',
        '',
        '# Build Output',
        'dist/',
        'build/',
        'out/',
        '.next/',
        '.nuxt/',
        '.cache/',
        '.parcel-cache/',
        '',
        '# Package Manager',
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        '',
        '# Testing',
        'coverage/',
        '.nyc_output/',
        '',
        '# Environment',
        '.env',
        '.env.local',
        '.env.*.local',
    ],
};

/**
 * Preset for Python projects
 */
export const PYTHON_PRESET: IgnorePreset = {
    name: 'Python',
    description: 'For Python, Django, Flask projects',
    patterns: [
        ...COMMON_PATTERNS,
        '# Python',
        '__pycache__/',
        '*.py[cod]',
        '*$py.class',
        '*.so',
        '',
        '# Virtual Environments',
        'venv/',
        'env/',
        '.venv/',
        'ENV/',
        'env.bak/',
        'venv.bak/',
        '',
        '# Distribution / Packaging',
        'dist/',
        'build/',
        '*.egg-info/',
        '.eggs/',
        '',
        '# Testing',
        '.pytest_cache/',
        '.tox/',
        '.coverage',
        'htmlcov/',
        '',
        '# Jupyter',
        '.ipynb_checkpoints/',
        '',
        '# Django',
        '*.sqlite3',
        'db.sqlite3',
        'media/',
        'staticfiles/',
    ],
};

/**
 * Preset for Rust projects
 */
export const RUST_PRESET: IgnorePreset = {
    name: 'Rust',
    description: 'For Rust projects using Cargo',
    patterns: [
        ...COMMON_PATTERNS,
        '# Rust / Cargo',
        'target/',
        '**/*.rlib',
        '**/*.rmeta',
        'incremental/',
        'Cargo.lock',
        '',
        '# Build artifacts',
        '**/*.rs.bk',
        '*.pdb',
    ],
};

/**
 * Preset for Java / Maven / Gradle projects
 */
export const JAVA_PRESET: IgnorePreset = {
    name: 'Java / Maven / Gradle',
    description: 'For Java, Kotlin, Spring Boot projects',
    patterns: [
        ...COMMON_PATTERNS,
        '# Java',
        '*.class',
        '*.jar',
        '*.war',
        '*.ear',
        '',
        '# Maven',
        'target/',
        'pom.xml.tag',
        'pom.xml.releaseBackup',
        'pom.xml.versionsBackup',
        'pom.xml.next',
        'release.properties',
        '',
        '# Gradle',
        '.gradle/',
        'build/',
        'gradle-app.setting',
        '!gradle-wrapper.jar',
        '',
        '# IntelliJ',
        '.idea/',
        '*.iml',
        '*.iws',
        'out/',
    ],
};

/**
 * Preset for Go projects
 */
export const GO_PRESET: IgnorePreset = {
    name: 'Go',
    description: 'For Go / Golang projects',
    patterns: [
        ...COMMON_PATTERNS,
        '# Go',
        'bin/',
        'pkg/',
        '*.exe',
        '*.exe~',
        '*.dll',
        '*.so',
        '*.dylib',
        '',
        '# Testing',
        '*.test',
        '*.out',
        '',
        '# Go workspace',
        'go.work',
    ],
};

/**
 * Preset for Linux kernel trees (Kconfig + arch/).
 */
export const LINUX_KERNEL_PRESET: IgnorePreset = {
    name: 'Linux kernel',
    description: 'For Linux / kernel trees — skip vmlinux, *.ko, dtb; still checkpoint *.c',
    patterns: [
        ...COMMON_PATTERNS,
        ...LINUX_KERNEL_IGNORE_PATTERNS,
    ],
};

/**
 * Preset for QEMU trees (meson + target/).
 */
export const QEMU_PRESET: IgnorePreset = {
    name: 'QEMU',
    description: 'For QEMU — skip qemu-system-* binaries and pc-bios blobs',
    patterns: [
        ...COMMON_PATTERNS,
        ...QEMU_IGNORE_PATTERNS,
    ],
};

export const CPP_PRESET: IgnorePreset = {
    name: 'C / C++',
    description: 'For C and C++ projects',
    patterns: [
        ...COMMON_PATTERNS,
        '# Compiled Object files',
        '*.o',
        '*.obj',
        '*.ko',
        '*.elf',
        '',
        '# Executables',
        '*.exe',
        '*.out',
        '*.app',
        '*.i*86',
        '*.x86_64',
        '*.hex',
        '',
        '# Libraries',
        '*.lib',
        '*.a',
        '*.la',
        '*.lo',
        '*.dll',
        '*.so',
        '*.so.*',
        '*.dylib',
        '',
        '# Build directories',
        'build/',
        'cmake-build-*/',
        '',
        '# CMake',
        'CMakeFiles/',
        'CMakeCache.txt',
        'cmake_install.cmake',
    ],
};

/**
 * Preset for .NET / C# projects
 */
export const DOTNET_PRESET: IgnorePreset = {
    name: '.NET / C#',
    description: 'For .NET, C#, ASP.NET projects',
    patterns: [
        ...COMMON_PATTERNS,
        '# Build results',
        '[Dd]ebug/',
        '[Dd]ebugPublic/',
        '[Rr]elease/',
        '[Rr]eleases/',
        'x64/',
        'x86/',
        'bld/',
        '[Bb]in/',
        '[Oo]bj/',
        '',
        '# Visual Studio',
        '.vs/',
        '*.user',
        '*.userosscache',
        '*.sln.docstates',
        '*.suo',
        '',
        '# NuGet',
        '*.nupkg',
        '*.snupkg',
        'packages/',
        '',
        '# Test Results',
        'TestResults/',
        '[Tt]est[Rr]esult*/',
    ],
};

/**
 * Preset for Ruby / Rails projects
 */
export const RUBY_PRESET: IgnorePreset = {
    name: 'Ruby / Rails',
    description: 'For Ruby and Ruby on Rails projects',
    patterns: [
        ...COMMON_PATTERNS,
        '# Ruby',
        '*.gem',
        '*.rbc',
        '.bundle/',
        'vendor/bundle/',
        '',
        '# Rails',
        'log/',
        'tmp/',
        'db/*.sqlite3',
        'db/*.sqlite3-journal',
        'public/system/',
        'public/uploads/',
        '',
        '# Environment',
        '.env',
        '.env.local',
    ],
};

/**
 * Preset for PHP projects
 */
export const PHP_PRESET: IgnorePreset = {
    name: 'PHP',
    description: 'For PHP, Laravel, Symfony projects',
    patterns: [
        ...COMMON_PATTERNS,
        '# Composer',
        'vendor/',
        'composer.lock',
        '',
        '# Laravel',
        'storage/',
        'bootstrap/cache/',
        '.env',
        '.env.backup',
        '',
        '# Symfony',
        'var/',
        'public/bundles/',
    ],
};

/**
 * Minimal preset for general projects
 */
export const MINIMAL_PRESET: IgnorePreset = {
    name: 'Minimal',
    description: 'Basic patterns for any project',
    patterns: [
        ...COMMON_PATTERNS,
    ],
};

/**
 * All available presets
 */
export const ALL_PRESETS: IgnorePreset[] = [
    MINIMAL_PRESET,
    LINUX_KERNEL_PRESET,
    QEMU_PRESET,
    NODE_PRESET,
    PYTHON_PRESET,
    RUST_PRESET,
    JAVA_PRESET,
    GO_PRESET,
    CPP_PRESET,
    DOTNET_PRESET,
    RUBY_PRESET,
    PHP_PRESET,
];

/**
 * Get a preset by name
 */
export function getPresetByName(name: string): IgnorePreset | undefined {
    return ALL_PRESETS.find(preset => 
        preset.name.toLowerCase() === name.toLowerCase()
    );
}

/**
 * Detect project type based on workspace files
 */
export async function detectProjectType(workspacePath: string): Promise<IgnorePreset | undefined> {
    const fs = require('fs');
    const path = require('path');
    
    try {
        const files = await fs.promises.readdir(workspacePath);
        const kind = detectCheckpointPresetKind(files);
        switch (kind) {
            case "kernel":
                return LINUX_KERNEL_PRESET;
            case "qemu":
                return QEMU_PRESET;
            case "node":
                return NODE_PRESET;
            case "rust":
                return RUST_PRESET;
            case "python":
                return PYTHON_PRESET;
            case "java":
                return JAVA_PRESET;
            case "go":
                return GO_PRESET;
            case "cpp":
                return CPP_PRESET;
            case "dotnet":
                return DOTNET_PRESET;
            case "ruby":
                return RUBY_PRESET;
            case "php":
                return PHP_PRESET;
            default:
                return MINIMAL_PRESET;
        }
    } catch (error) {
        console.error('Failed to detect project type:', error);
        return MINIMAL_PRESET;
    }
}

/**
 * Generate .knoxignore content from a preset
 */
export function generateKnoxIgnoreContent(preset: IgnorePreset): string {
    return [
        `# Knox Checkpoint System - Ignore Patterns`,
        `# Generated for: ${preset.name}`,
        `# ${preset.description}`,
        `#`,
        `# This file tells the Knox checkpoint system which files to ignore.`,
        `# Similar to .gitignore, but specific to checkpoint tracking.`,
        '',
        ...preset.patterns,
    ].join('\n');
}

/**
 * Create ~/.knox/.knoxignore with a preset (global, not per-project).
 */
export async function createKnoxIgnoreFile(
    _workspacePath: string | undefined,
    preset: IgnorePreset
): Promise<string> {
    const fs = require('fs').promises;
    const path = require('path');

    const knoxignorePath = getGlobalKnoxIgnorePath();
    await fs.mkdir(path.dirname(knoxignorePath), { recursive: true });
    const content = generateKnoxIgnoreContent(preset);

    await fs.writeFile(knoxignorePath, content, 'utf8');
    console.log(`✅ Created global .knoxignore at ${knoxignorePath} with ${preset.name} preset`);
    return knoxignorePath;
}

