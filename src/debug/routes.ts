/**
 * Debug address names live in one place.
 *
 * The public names are English and intentionally have no aliases: a debug URL
 * should have one spelling, otherwise docs, screenshots, and bug reports drift.
 */
export type DebugRoute =
  | 'frames'
  | 'fluffy'
  | 'shift'
  | 'test'
  | 'battle'
  | 'meet'
  | 'trail'
  | 'wheel'
  | 'town'
  | 'fan'
  | 'avatars'
  | 'collection';

const DEBUG_SCENE_ROUTES: readonly (DebugRoute | 'tier' | 'node' | 'castle' | 'grave')[] = [
  'tier',
  'node',
  'test',
  'castle',
  'grave',
  'trail',
  'meet',
  'town',
  'battle',
  'wheel',
  'fan',
  'avatars',
];

export function debugHas(params: URLSearchParams, route: DebugRoute | 'tier' | 'node' | 'castle' | 'grave'): boolean {
  return params.has(route);
}

export function debugGet(
  params: URLSearchParams,
  route: DebugRoute | 'tier' | 'node' | 'castle' | 'grave',
): string | null {
  return params.get(route);
}

export function debugSceneOpen(params: URLSearchParams): boolean {
  return DEBUG_SCENE_ROUTES.some((route) => debugHas(params, route));
}
