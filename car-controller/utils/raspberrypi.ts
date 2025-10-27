import { readFileSync } from 'node:fs';

export function isRaspberryPi(): boolean {
    try {
        const cpuInfo = readFileSync('/proc/cpuinfo', 'utf8').toLowerCase();
        return cpuInfo.includes('raspberry pi') || cpuInfo.includes('bcm');
    } catch {
        return false;
    }
}