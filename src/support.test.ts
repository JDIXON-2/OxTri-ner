import { expect, it } from 'vitest';
import { checkSupport } from './support';

it('rejects when navigator.bluetooth is missing', () => {
  expect(checkSupport({ navigator: {} }).ok).toBe(false);
});
it('rejects insecure contexts', () => {
  expect(checkSupport({ isSecureContext: false, navigator: { bluetooth: {} } }).ok).toBe(false);
});
it('accepts supported browsers', () => {
  expect(checkSupport({ isSecureContext: true, navigator: { bluetooth: {} } }).ok).toBe(true);
});
