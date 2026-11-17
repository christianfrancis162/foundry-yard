// The look plan, in one place. Base six plus named zone colours: the warm sand of
// Site A, the cool slate of Site B, and a brick red for accent walls. The lighting
// makes every shade the game needs, so no other colour appears in the code. The same
// names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#14161a',
  surface: '#262b33',
  hairline: '#39414b',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830',
  siteA: '#8a6d3f',
  siteB: '#4a6a7d',
  brick: '#7a4a38',
  skyTop: '#2e4a6b',
  skyHorizon: '#c98f4e',
};

export function shade(name) {
  return PALETTE[name];
}
