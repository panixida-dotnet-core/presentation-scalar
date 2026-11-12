import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import { JSDOM } from 'jsdom';

const [, , lcovPath, sonarPath] = process.argv;
const lines = new Map();
const branches = new Map();
let sourcePath;

for (const record of readFileSync(lcovPath, 'utf8').split(/\r?\n/)) {
    if (record.startsWith('SF:')) {
        if (sourcePath) {
            throw new Error('Expected coverage for one console JavaScript file.');
        }
        sourcePath = relative(process.cwd(), resolve(record.slice(3))).split(sep).join('/');
    } else if (record.startsWith('DA:')) {
        const [line, hits] = record.slice(3).split(',');
        lines.set(Number(line), Number(hits) > 0);
    } else if (record.startsWith('BRDA:')) {
        const [line, , , hits] = record.slice(5).split(',');
        const number = Number(line);
        const counts = branches.get(number) ?? [];
        counts.push(Number(hits) > 0);
        branches.set(number, counts);
    }
}

if (!sourcePath || lines.size === 0) {
    throw new Error('No JavaScript coverage was reported for the console.');
}

const report = new JSDOM(readFileSync(sonarPath, 'utf8'), { contentType: 'application/xml' });
const { document } = report.window;
const file = document.createElement('file');
file.setAttribute('path', sourcePath);

for (const [line, covered] of lines) {
    const entry = document.createElement('lineToCover');
    entry.setAttribute('lineNumber', String(line));
    entry.setAttribute('covered', String(covered));
    const counts = branches.get(line);
    if (counts) {
        entry.setAttribute('branchesToCover', String(counts.length));
        entry.setAttribute('coveredBranches', String(counts.filter(Boolean).length));
    }
    file.append(entry);
}

document.documentElement.append(file);
writeFileSync(sonarPath, report.serialize());
