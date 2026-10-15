import { motionTokens } from './tokens';

const geometryByDay = new Map<string, string>();
let maskNumber = 0;

/** Claim only when the live map is ready; StrictMode's discarded effect never consumes it. */
export function claimRouteReveal(day: string, geometry: string) {
  if (geometryByDay.get(day) === geometry) return false;
  geometryByDay.delete(day); geometryByDay.set(day, geometry);
  if (geometryByDay.size > 100) geometryByDay.delete(geometryByDay.keys().next().value!);
  return true;
}

/** A mask reveals geometry while preserving the route's own dashed/flight stroke. */
export function revealPath(path: SVGPathElement, duration: number) {
  const svg = path.ownerSVGElement;
  const length = path.getTotalLength();
  if (!svg || !length) return () => {};
  const ns = 'http://www.w3.org/2000/svg';
  const mask = document.createElementNS(ns, 'mask'), stroke = document.createElementNS(ns, 'path');
  const id = `travelai-route-${++maskNumber}`;
  mask.id = id; mask.setAttribute('maskUnits', 'userSpaceOnUse');
  const box = path.getBBox();
  mask.setAttribute('x', String(box.x - 20)); mask.setAttribute('y', String(box.y - 20));
  mask.setAttribute('width', String(box.width + 40)); mask.setAttribute('height', String(box.height + 40));
  stroke.setAttribute('d', path.getAttribute('d') || ''); stroke.setAttribute('fill', 'none');
  stroke.setAttribute('stroke', 'white'); stroke.setAttribute('stroke-width', '24'); stroke.setAttribute('stroke-linecap', 'round');
  stroke.setAttribute('stroke-dasharray', String(length)); mask.append(stroke); svg.append(mask);
  path.setAttribute('mask', `url(#${id})`);
  const animation = stroke.animate([{ strokeDashoffset: String(length) }, { strokeDashoffset: '0' }], { duration, easing: motionTokens.cssEase });
  const clear = () => { path.removeAttribute('mask'); mask.remove(); };
  animation.finished.then(clear, clear);
  return () => { animation.cancel(); clear(); };
}
