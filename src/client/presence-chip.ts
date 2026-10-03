import { presenceLabel } from '../core/presence';
import type { LiveHandlers } from './live';

export const updatePresenceChip: NonNullable<LiveHandlers['presence']> = ({ presence, undelivered }) => {
  const chip = document.querySelector('[data-testid="presence"]');
  if (!chip) return;
  chip.setAttribute('data-state', presence);
  const label = chip.querySelector('.presence-label');
  if (label) label.textContent = presenceLabel(presence, undelivered);
};
