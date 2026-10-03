import type { Boot } from '../shared/frames';

const bootEl = document.getElementById('pinpoint-boot');
const boot = JSON.parse(bootEl?.textContent ?? 'null') as Boot | null;
console.debug(boot);
