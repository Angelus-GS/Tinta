// Codecs postcard para los tipos de aidoku-rs que cruzan la frontera del host.
// El orden de campos es el de aidoku-rs (verificado en Fase 0 contra
// MangaDex v14: decodificaciones byte-exactas de principio a fin).
import { Dec, encString, encVarint, encZigzag, encOpt, encVec, concat } from './postcard.js';

export const MangaStatus = ['Unknown', 'Ongoing', 'Completed', 'Cancelled', 'Hiatus'];
export const ContentRating = ['Unknown', 'Safe', 'Suggestive', 'NSFW'];
export const Viewer = ['Unknown', 'LeftToRight', 'RightToLeft', 'Vertical', 'Webtoon'];

const optStr = (d) => d.option((x) => x.string());
const strArr = (d) => d.vec((x) => x.string());
const f32bytes = (x) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); return b; };

export function decChapter(d) {
  return {
    key: d.string(),
    title: optStr(d),
    chapter_number: d.option((x) => x.f32()),
    volume_number: d.option((x) => x.f32()),
    date_uploaded: d.option((x) => x.i64()),
    scanlators: d.option(strArr),
    url: optStr(d),
    language: optStr(d),
    thumbnail: optStr(d),
    locked: d.bool(),
  };
}

export function encChapter(c) {
  return concat([
    encString(c.key),
    encOpt(c.title, encString),
    encOpt(c.chapter_number, f32bytes),
    encOpt(c.volume_number, f32bytes),
    encOpt(c.date_uploaded, encZigzag),
    encOpt(c.scanlators, (a) => encVec(a, encString)),
    encOpt(c.url, encString),
    encOpt(c.language, encString),
    encOpt(c.thumbnail, encString),
    Uint8Array.of(c.locked ? 1 : 0),
  ]);
}

export function decManga(d) {
  return {
    key: d.string(),
    title: d.string(),
    cover: optStr(d),
    artists: d.option(strArr),
    authors: d.option(strArr),
    description: optStr(d),
    url: optStr(d),
    tags: d.option(strArr),
    status: d.usize(),
    content_rating: d.usize(),
    viewer: d.usize(),
    update_strategy: d.usize(),
    next_update_time: d.option((x) => x.i64()),
    chapters: d.option((x) => x.vec(decChapter)),
  };
}

export function encManga(m) {
  return concat([
    encString(m.key),
    encString(m.title),
    encOpt(m.cover, encString),
    encOpt(m.artists, (a) => encVec(a, encString)),
    encOpt(m.authors, (a) => encVec(a, encString)),
    encOpt(m.description, encString),
    encOpt(m.url, encString),
    encOpt(m.tags, (a) => encVec(a, encString)),
    encVarint(m.status),
    encVarint(m.content_rating),
    encVarint(m.viewer),
    encVarint(m.update_strategy),
    encOpt(m.next_update_time, encZigzag),
    encOpt(m.chapters, (a) => encVec(a, encChapter)),
  ]);
}

export function decMangaPageResult(d) {
  return { entries: d.vec(decManga), has_next_page: d.bool() };
}

export function decListing(d) {
  return { id: d.string(), name: d.string(), kind: d.usize() };
}

export function decPage(d) {
  const variant = d.usize();
  let content;
  if (variant === 0) {
    const url = d.string();
    const ctx = d.option((x) => {
      const n = x.usize();
      const o = {};
      for (let i = 0; i < n; i++) { const k = x.string(); o[k] = x.string(); }
      return o;
    });
    content = { type: 'url', url, ctx };
  } else if (variant === 1) {
    content = { type: 'text', text: d.string() };
  } else if (variant === 3) {
    content = { type: 'zip', zip: d.string(), file: d.string() };
  } else {
    content = { type: 'image', variant };
  }
  return {
    content,
    thumbnail: optStr(d),
    has_description: d.bool(),
    description: optStr(d),
  };
}

export { Dec };
