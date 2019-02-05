import _Promise from 'babel-runtime/core-js/promise';
import fs from 'fs';
import _extends from 'babel-runtime/helpers/extends';
import BlobStream from 'blob-stream';
import ReactFiberReconciler from 'react-reconciler';
import emptyObject from 'fbjs/lib/emptyObject';
import PDFDocument, { PDFFont } from '@react-pdf/pdfkit';
import wrapPages from 'page-wrapping';
import _Object$keys from 'babel-runtime/core-js/object/keys';
import _objectWithoutProperties from 'babel-runtime/helpers/objectWithoutProperties';
import isUrl from 'is-url';
import fontkit from '@react-pdf/fontkit';
import fetch from 'isomorphic-fetch';
import _Array$from from 'babel-runtime/core-js/array/from';
import emojiRegex from 'emoji-regex';
import { Attachment, AttributedString, Container, LayoutEngine, Path, Rect } from '@react-pdf/textkit-core';
import scriptItemizer from '@react-pdf/script-itemizer';
import justificationEngine from '@textkit/justification-engine';
import textDecorationEngine from '@textkit/text-decoration-engine';
import english from 'hyphenation.en-us';
import Hypher from 'hypher';
import _JSON$stringify from 'babel-runtime/core-js/json/stringify';
import path from 'path';
import url from 'url';
import PNG from '@react-pdf/png-js';
import _Object$assign from 'babel-runtime/core-js/object/assign';
import { Fragment } from 'react';
import Yoga from 'yoga-layout';
import warning from 'fbjs/lib/warning';
import toPairsIn from 'lodash.topairsin';
import isFunction from 'lodash.isfunction';
import pick from 'lodash.pick';
import merge from 'lodash.merge';
import matchMedia from 'media-engine';
import createPDFRenderer from '@textkit/pdf-renderer';

class Root {
  constructor() {
    this.isDirty = false;
    this.document = null;
    this.instance = null;
  }

  get name() {
    return 'Root';
  }

  appendChild(child) {
    this.document = child;
  }

  removeChild() {
    this.document = null;
  }

  markDirty() {
    this.isDirty = true;
  }

  async render() {
    this.instance = new PDFDocument({ autoFirstPage: false });
    await this.document.render();
    this.isDirty = false;
  }
}

var standardFonts = ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Times-Roman', 'Times-Bold', 'Times-Italic'];

const fetchFont = src => {
  return fetch(src).then(response => {
    if (response.buffer) {
      return response.buffer();
    }
    return response.arrayBuffer();
  }).then(arrayBuffer => Buffer.from(arrayBuffer));
};

let fonts = {};
let emojiSource;
let hyphenationCallback;

const register = (src, _ref) => {
  let { family } = _ref,
      otherOptions = _objectWithoutProperties(_ref, ['family']);

  fonts[family] = _extends({
    src,
    loaded: false,
    loading: false,
    data: null
  }, otherOptions);
};

const registerHyphenationCallback = callback => {
  hyphenationCallback = callback;
};

const registerEmojiSource = ({ url: url$$1, format = 'png' }) => {
  emojiSource = { url: url$$1, format };
};

const getRegisteredFonts = () => _Object$keys(fonts);

const getFont = family => fonts[family];

const getEmojiSource = () => emojiSource;

const getHyphenationCallback = () => hyphenationCallback;

const load = async function (fontFamily, doc) {
  const font = fonts[fontFamily];

  // We cache the font to avoid fetching it many times
  if (font && !font.data && !font.loading) {
    font.loading = true;

    if (isUrl(font.src)) {
      const data = await fetchFont(font.src);
      font.data = fontkit.create(data);
    } else {
      font.data = await new _Promise((resolve, reject) => fontkit.open(font.src, (err, data) => err ? reject(err) : resolve(data)));
    }
  }

  // If the font wasn't added to the document yet (aka. loaded), we add it.
  // This prevents calling `registerFont` many times for the same font.
  // Fonts loaded state will be reset after the document is closed.
  if (font && !font.loaded) {
    font.loaded = true;
    font.loading = false;
    doc.registerFont(fontFamily, font.data);
  }

  if (!font && !standardFonts.includes(fontFamily)) {
    throw new Error(`Font family not registered: ${fontFamily}. Please register it calling Font.register() method.`);
  }
};

const reset = function () {
  for (const font in fonts) {
    if (fonts.hasOwnProperty(font)) {
      fonts[font].loaded = false;
    }
  }
};

const clear = function () {
  fonts = {};
};

var Font = {
  register,
  getEmojiSource,
  getRegisteredFonts,
  registerEmojiSource,
  registerHyphenationCallback,
  getHyphenationCallback,
  getFont,
  load,
  clear,
  reset
};

class StandardFont {
  constructor(src) {
    this.name = src;
    this.src = PDFFont.open(null, src);
  }

  layout(str) {
    const [encoded, positions] = this.src.encode(str);

    return {
      positions,
      stringIndices: positions.map((_, i) => i),
      glyphs: encoded.map((g, i) => {
        const glyph = this.getGlyph(parseInt(g, 16));
        glyph.advanceWidth = positions[i].advanceWidth;
        return glyph;
      })
    };
  }

  glyphForCodePoint(codePoint) {
    const glyph = this.getGlyph(codePoint);
    glyph.advanceWidth = 400;
    return glyph;
  }

  getGlyph(id) {
    return {
      id,
      _font: this.src,
      codePoints: [id],
      isLigature: false,
      name: this.src.font.characterToGlyph(id)
    };
  }

  hasGlyphForCodePoint(codePoint) {
    return this.src.font.characterToGlyph(codePoint) !== '.notdef';
  }

  get ascent() {
    return this.src.ascender;
  }

  get descent() {
    return this.src.descender;
  }

  get lineGap() {
    return this.src.lineGap;
  }

  get unitsPerEm() {
    return 1000;
  }
}

var fontSubstitutionEngine = (() => ({ Run }) => class FontSubstitutionEngine {
  constructor() {
    this.fontCache = {};
  }

  get fallbackFont() {
    return this.getOrCreateFont('Helvetica');
  }

  getOrCreateFont(name) {
    if (this.fontCache[name]) return this.fontCache[name];

    const font = new StandardFont(name);
    this.fontCache[name] = font;

    return font;
  }

  shouldFallbackToFont(codePoint, font) {
    return !font.hasGlyphForCodePoint(codePoint) && this.fallbackFont.hasGlyphForCodePoint(codePoint);
  }

  getRuns(string, runs) {
    const res = [];
    let lastFont = null;
    let lastIndex = 0;
    let index = 0;

    for (const run of runs) {
      const defaultFont = typeof run.attributes.font === 'string' ? this.getOrCreateFont(run.attributes.font) : run.attributes.font;

      if (string.length === 0) {
        res.push(new Run(0, 0, { font: defaultFont }));
        break;
      }

      for (const char of string.slice(run.start, run.end)) {
        const codePoint = char.codePointAt();
        const font = this.shouldFallbackToFont(codePoint, defaultFont) ? this.fallbackFont : defaultFont;

        // If the default font does not have a glyph and the fallback font does, we use it
        if (font !== lastFont) {
          if (lastFont) {
            res.push(new Run(lastIndex, index, { font: lastFont }));
          }

          lastFont = font;
          lastIndex = index;
        }

        index += char.length;
      }
    }

    if (lastIndex < string.length) {
      res.push(new Run(lastIndex, string.length, { font: lastFont }));
    }

    return res;
  }
});

const SOFT_HYPHEN_HEX = '\u00ad';
const hypher = new Hypher(english);

var wordHyphenation = (({ hyphenationCallback }) => () => class {
  constructor() {
    this.cache = {};
  }

  calculateParts(word) {
    return word.includes(SOFT_HYPHEN_HEX) ? word.split(SOFT_HYPHEN_HEX) : hypher.hyphenate(word);
  }

  hyphenateWord(word) {
    if (this.cache[word]) return this.cache[word];

    const parts = hyphenationCallback ? hyphenationCallback(word) : this.calculateParts(word);

    this.cache[word] = parts;

    return parts;
  }
});

class Node {
  constructor(data) {
    this.prev = null;
    this.next = null;
    this.data = data;
  }

  toString() {
    return this.data.toString();
  }
}

class LinkedList {

  constructor() {
    this.head = null;
    this.tail = null;
    this.listSize = 0;
  }

  isLinked(node) {
    return !(node && node.prev === null && node.next === null && this.tail !== node && this.head !== node || this.isEmpty());
  }

  size() {
    return this.listSize;
  }

  isEmpty() {
    return this.listSize === 0;
  }

  first() {
    return this.head;
  }

  last() {
    return this.last;
  }

  toString() {
    return this.toArray().toString();
  }

  toArray() {
    let node = this.head;
    const result = [];

    while (node !== null) {
      result.push(node);
      node = node.next;
    }
    return result;
  }

  forEach(fun) {
    let node = this.head;

    while (node !== null) {
      fun(node);
      node = node.next;
    }
  }

  contains(n) {
    let node = this.head;

    if (!this.isLinked(n)) {
      return false;
    }
    while (node !== null) {
      if (node === n) {
        return true;
      }
      node = node.next;
    }
    return false;
  }

  at(i) {
    let node = this.head;
    let index = 0;

    if (i >= this.listLength || i < 0) {
      return null;
    }

    while (node !== null) {
      if (i === index) {
        return node;
      }
      node = node.next;
      index += 1;
    }
    return null;
  }

  insertAfter(node, newNode) {
    if (!this.isLinked(node)) {
      return this;
    }
    newNode.prev = node;
    newNode.next = node.next;
    if (node.next === null) {
      this.tail = newNode;
    } else {
      node.next.prev = newNode;
    }
    node.next = newNode;
    this.listSize += 1;
    return this;
  }

  insertBefore(node, newNode) {
    if (!this.isLinked(node)) {
      return this;
    }
    newNode.prev = node.prev;
    newNode.next = node;
    if (node.prev === null) {
      this.head = newNode;
    } else {
      node.prev.next = newNode;
    }
    node.prev = newNode;
    this.listSize += 1;
    return this;
  }

  push(node) {
    if (this.head === null) {
      this.unshift(node);
    } else {
      this.insertAfter(this.tail, node);
    }
    return this;
  }

  unshift(node) {
    if (this.head === null) {
      this.head = node;
      this.tail = node;
      node.prev = null;
      node.next = null;
      this.listSize += 1;
    } else {
      this.insertBefore(this.head, node);
    }
    return this;
  }

  remove(node) {
    if (!this.isLinked(node)) {
      return this;
    }
    if (node.prev === null) {
      this.head = node.next;
    } else {
      node.prev.next = node.next;
    }
    if (node.next === null) {
      this.tail = node.prev;
    } else {
      node.next.prev = node.prev;
    }
    this.listSize -= 1;
    return this;
  }

  pop() {
    const node = this.tail;
    this.tail.prev.next = null;
    this.tail = this.tail.prev;
    this.listSize -= 1;
    node.prev = null;
    node.next = null;
    return node;
  }

  shift() {
    const node = this.head;
    this.head.next.prev = null;
    this.head = this.head.next;
    this.listSize -= 1;
    node.prev = null;
    node.next = null;
    return node;
  }
}

LinkedList.Node = Node;

/**
 * @preserve Knuth and Plass line breaking algorithm in JavaScript
 *
 * Licensed under the new BSD License.
 * Copyright 2009-2010, Bram Stein
 * All rights reserved.
 */
const linebreak = (nodes, lines, settings) => {
  const options = {
    demerits: {
      line: settings && settings.demerits && settings.demerits.line || 10,
      flagged: settings && settings.demerits && settings.demerits.flagged || 100,
      fitness: settings && settings.demerits && settings.demerits.fitness || 3000
    },
    tolerance: settings && settings.tolerance || 3
  };
  const activeNodes = new LinkedList();
  const sum = {
    width: 0,
    stretch: 0,
    shrink: 0
  };
  const lineLengths = lines;
  const breaks = [];
  let tmp = {
    data: {
      demerits: Infinity
    }
  };

  function breakpoint(position, demerits, ratio, line, fitnessClass, totals, previous) {
    return {
      position,
      demerits,
      ratio,
      line,
      fitnessClass,
      totals: totals || {
        width: 0,
        stretch: 0,
        shrink: 0
      },
      previous
    };
  }

  function computeCost(start, end, active, currentLine) {
    let width = sum.width - active.totals.width;
    let stretch = 0;
    let shrink = 0;
    // If the current line index is within the list of linelengths, use it, otherwise use
    // the last line length of the list.
    const lineLength = currentLine < lineLengths.length ? lineLengths[currentLine - 1] : lineLengths[lineLengths.length - 1];

    if (nodes[end].type === 'penalty') {
      width += nodes[end].width;
    }

    if (width < lineLength) {
      // Calculate the stretch ratio
      stretch = sum.stretch - active.totals.stretch;

      if (stretch > 0) {
        return (lineLength - width) / stretch;
      }

      return linebreak.infinity;
    } else if (width > lineLength) {
      // Calculate the shrink ratio
      shrink = sum.shrink - active.totals.shrink;

      if (shrink > 0) {
        return (lineLength - width) / shrink;
      }

      return linebreak.infinity;
    }

    // perfect match
    return 0;
  }

  // Add width, stretch and shrink values from the current
  // break point up to the next box or forced penalty.
  function computeSum(breakPointIndex) {
    const result = {
      width: sum.width,
      stretch: sum.stretch,
      shrink: sum.shrink
    };

    for (let i = breakPointIndex; i < nodes.length; i += 1) {
      if (nodes[i].type === 'glue') {
        result.width += nodes[i].width;
        result.stretch += nodes[i].stretch;
        result.shrink += nodes[i].shrink;
      } else if (nodes[i].type === 'box' || nodes[i].type === 'penalty' && nodes[i].penalty === -linebreak.infinity && i > breakPointIndex) {
        break;
      }
    }
    return result;
  }

  // The main loop of the algorithm
  function mainLoop(node, index, nodes) {
    let active = activeNodes.first();
    let next = null;
    let ratio = 0;
    let demerits = 0;
    let candidates = [];
    let badness;
    let currentLine = 0;
    let tmpSum;
    let currentClass = 0;
    let fitnessClass;
    let candidate;
    let newNode;

    // The inner loop iterates through all the active nodes with line < currentLine and then
    // breaks out to insert the new active node candidates before looking at the next active
    // nodes for the next lines. The result of this is that the active node list is always
    // sorted by line number.
    while (active !== null) {
      candidates = [{
        demerits: Infinity
      }, {
        demerits: Infinity
      }, {
        demerits: Infinity
      }, {
        demerits: Infinity
      }];

      // Iterate through the linked list of active nodes to find new potential active nodes
      // and deactivate current active nodes.
      while (active !== null) {
        next = active.next;
        currentLine = active.data.line + 1;
        ratio = computeCost(active.data.position, index, active.data, currentLine);

        // Deactive nodes when the distance between the current active node and the
        // current node becomes too large (i.e. it exceeds the stretch limit and the stretch
        // ratio becomes negative) or when the current node is a forced break (i.e. the end
        // of the paragraph when we want to remove all active nodes, but possibly have a final
        // candidate active node---if the paragraph can be set using the given tolerance value.)
        if (ratio < -1 || node.type === 'penalty' && node.penalty === -linebreak.infinity) {
          activeNodes.remove(active);
        }

        // If the ratio is within the valid range of -1 <= ratio <= tolerance calculate the
        // total demerits and record a candidate active node.
        if (ratio >= -1 && ratio <= options.tolerance) {
          badness = 100 * Math.pow(Math.abs(ratio), 3);

          // Positive penalty
          if (node.type === 'penalty' && node.penalty >= 0) {
            demerits = Math.pow(options.demerits.line + badness, 2) + Math.pow(node.penalty, 2);
            // Negative penalty but not a forced break
          } else if (node.type === 'penalty' && node.penalty !== -linebreak.infinity) {
            demerits = Math.pow(options.demerits.line + badness, 2) - Math.pow(node.penalty, 2);
            // All other cases
          } else {
            demerits = Math.pow(options.demerits.line + badness, 2);
          }

          if (node.type === 'penalty' && nodes[active.data.position].type === 'penalty') {
            demerits += options.demerits.flagged * node.flagged * nodes[active.data.position].flagged;
          }

          // Calculate the fitness class for this candidate active node.
          if (ratio < -0.5) {
            currentClass = 0;
          } else if (ratio <= 0.5) {
            currentClass = 1;
          } else if (ratio <= 1) {
            currentClass = 2;
          } else {
            currentClass = 3;
          }

          // Add a fitness penalty to the demerits if the fitness classes of two adjacent lines
          // differ too much.
          if (Math.abs(currentClass - active.data.fitnessClass) > 1) {
            demerits += options.demerits.fitness;
          }

          // Add the total demerits of the active node to get the total demerits of this candidate node.
          demerits += active.data.demerits;

          // Only store the best candidate for each fitness class
          if (demerits < candidates[currentClass].demerits) {
            candidates[currentClass] = {
              active,
              demerits,
              ratio
            };
          }
        }

        active = next;

        // Stop iterating through active nodes to insert new candidate active nodes in the active list
        // before moving on to the active nodes for the next line.
        // TODO: The Knuth and Plass paper suggests a conditional for currentLine < j0. This means paragraphs
        // with identical line lengths will not be sorted by line number. Find out if that is a desirable outcome.
        // For now I left this out, as it only adds minimal overhead to the algorithm and keeping the active node
        // list sorted has a higher priority.
        if (active !== null && active.data.line >= currentLine) {
          break;
        }
      }

      tmpSum = computeSum(index);

      for (fitnessClass = 0; fitnessClass < candidates.length; fitnessClass += 1) {
        candidate = candidates[fitnessClass];

        if (candidate.demerits < Infinity) {
          newNode = new LinkedList.Node(breakpoint(index, candidate.demerits, candidate.ratio, candidate.active.data.line + 1, fitnessClass, tmpSum, candidate.active));
          if (active !== null) {
            activeNodes.insertBefore(active, newNode);
          } else {
            activeNodes.push(newNode);
          }
        }
      }
    }
  }

  // Add an active node for the start of the paragraph.
  activeNodes.push(new LinkedList.Node(breakpoint(0, 0, 0, 0, 0, undefined, null)));

  nodes.forEach((node, index, nodes) => {
    if (node.type === 'box') {
      sum.width += node.width;
    } else if (node.type === 'glue') {
      if (index > 0 && nodes[index - 1].type === 'box') {
        mainLoop(node, index, nodes);
      }
      sum.width += node.width;
      sum.stretch += node.stretch;
      sum.shrink += node.shrink;
    } else if (node.type === 'penalty' && node.penalty !== linebreak.infinity) {
      mainLoop(node, index, nodes);
    }
  });

  if (activeNodes.size() !== 0) {
    // Find the best active node (the one with the least total demerits.)
    activeNodes.forEach(node => {
      if (node.data.demerits < tmp.data.demerits) {
        tmp = node;
      }
    });

    while (tmp !== null) {
      breaks.push({
        position: tmp.data.position,
        ratio: tmp.data.ratio
      });
      tmp = tmp.data.previous;
    }
    return breaks.reverse();
  }
  return [];
};

linebreak.infinity = 10000;

linebreak.glue = (width, value, stretch, shrink) => ({
  type: 'glue',
  value,
  width,
  stretch,
  shrink
});

linebreak.box = (width, value, hyphenated = false) => ({
  type: 'box',
  width,
  value,
  hyphenated
});

linebreak.penalty = (width, penalty, flagged) => ({
  type: 'penalty',
  width,
  penalty,
  flagged
});

const INFINITY = 10000;

const getNextBreakpoint = (subnodes, widths, lineNumber) => {
  let position = null;
  let minimumBadness = Infinity;

  const sum = { width: 0, stretch: 0, shrink: 0 };
  const lineLength = widths[Math.min(lineNumber, widths.length - 1)];

  const calculateRatio = node => {
    if (sum.width < lineLength) {
      return sum.stretch - node.stretch > 0 ? (lineLength - sum.width) / sum.stretch : INFINITY;
    } else if (sum.width > lineLength) {
      return sum.shrink - node.shrink > 0 ? (lineLength - sum.width) / sum.shrink : INFINITY;
    }

    return 0;
  };

  for (let i = 0; i < subnodes.length; i++) {
    const node = subnodes[i];

    if (node.type === 'box') {
      sum.width += node.width;
    } else if (node.type === 'glue') {
      sum.width += node.width;
      sum.stretch += node.stretch;
      sum.shrink += node.shrink;
    }

    if (sum.width - sum.shrink > lineLength) break;

    if (node.type === 'penalty' || node.type === 'glue') {
      const ratio = calculateRatio(node);
      const penalty = node.type === 'penalty' ? node.penalty : 0;
      const badness = 100 * Math.pow(Math.abs(ratio), 3) + penalty;

      if (minimumBadness >= badness) {
        position = i;
        minimumBadness = badness;
      }
    }
  }

  return sum.width - sum.shrink > lineLength ? position : null;
};

const applyBestFit = (nodes, widths) => {
  let count = 0;
  let lineNumber = 0;
  let subnodes = nodes;
  const breakpoints = [{ position: 0 }];

  while (subnodes.length > 0) {
    const breakpoint = getNextBreakpoint(subnodes, widths, lineNumber);

    if (breakpoint) {
      count += breakpoint;
      breakpoints.push({ position: count });
      subnodes = subnodes.slice(breakpoint + 1, subnodes.length);
      count++;
      lineNumber++;
    } else {
      subnodes = [];
    }
  }

  return breakpoints;
};

const HYPHEN = 0x002d;
const TOLERANCE_STEPS = 5;
const TOLERANCE_LIMIT = 50;

const opts = {
  width: 3,
  stretch: 6,
  shrink: 9
};

var lineBreaker = (({ penalty } = {}) => () => {
  return class KPLineBreaker {
    constructor(tolerance) {
      this.tolerance = tolerance || 4;
    }

    getNodes(glyphString, syllables, { align }) {
      let start = 0;
      const hyphenWidth = 5;
      const hyphenPenalty = penalty || (align === 'justify' ? 100 : 600);

      const result = syllables.reduce((acc, s, index) => {
        const glyphStart = glyphString.glyphIndexForStringIndex(start);
        const glyphEnd = glyphString.glyphIndexForStringIndex(start + s.length);
        const syllable = glyphString.slice(glyphStart, glyphEnd);

        if (syllable.string.trim() === '') {
          const width = syllable.advanceWidth;
          const stretch = width * opts.width / opts.stretch;
          const shrink = width * opts.width / opts.shrink;
          const value = { value: syllable, start, end: start + syllable.end };
          acc.push(linebreak.glue(width, value, stretch, shrink));
        } else {
          const hyphenated = syllables[index + 1] !== ' ';
          const value = { value: syllable, start, end: start + syllable.end };
          acc.push(linebreak.box(syllable.advanceWidth, value, hyphenated));

          if (syllables[index + 1] && hyphenated) {
            acc.push(linebreak.penalty(hyphenWidth, hyphenPenalty, 1));
          }
        }

        start += s.length;

        return acc;
      }, []);

      result.push(linebreak.glue(0, null, linebreak.infinity, 0));
      result.push(linebreak.penalty(0, -linebreak.infinity, 1));

      return result;
    }

    breakLines(glyphString, nodes, breaks) {
      let start = 0;
      let end = null;

      const lines = breaks.reduce((acc, breakPoint) => {
        const node = nodes[breakPoint.position];
        const prevNode = nodes[breakPoint.position - 1];

        // Last breakpoint corresponds to K&P mandatory final glue
        if (breakPoint.position === nodes.length - 1) return acc;

        let line;
        if (node.type === 'penalty') {
          end = glyphString.glyphIndexForStringIndex(prevNode.value.end);
          line = glyphString.slice(start, end);
          line.insertGlyph(line.length, HYPHEN);
        } else {
          end = glyphString.glyphIndexForStringIndex(node.value.end);
          line = glyphString.slice(start, end);
        }

        start = end;
        return [...acc, line];
      }, []);

      const lastLine = glyphString.slice(start, glyphString.length);
      lines.push(lastLine);

      return lines;
    }

    suggestLineBreak(glyphString, syllables, availableWidths, paragraphStyle) {
      const nodes = this.getNodes(glyphString, syllables, paragraphStyle);
      let tolerance = this.tolerance;
      let breaks = linebreak(nodes, availableWidths, { tolerance });

      // Try again with a higher tolerance if the line breaking failed.
      while (breaks.length === 0 && tolerance < TOLERANCE_LIMIT) {
        tolerance += TOLERANCE_STEPS;
        breaks = linebreak(nodes, availableWidths, { tolerance });
      }

      if (breaks.length === 0 || breaks.length === 1 && breaks[0].position === 0) {
        breaks = applyBestFit(nodes, availableWidths);
      }

      return this.breakLines(glyphString, nodes, breaks.slice(1));
    }
  };
});

// justificationEngine values
const shrinkWhitespaceFactor = { before: -0.5, after: -0.5 };

class LayoutEngine$1 extends LayoutEngine {
  constructor({ hyphenationCallback, hyphenationPenalty }) {
    const engines = {
      scriptItemizer: scriptItemizer(),
      decorationEngine: textDecorationEngine(),
      fontSubstitutionEngine: fontSubstitutionEngine(),
      wordHyphenation: wordHyphenation({ hyphenationCallback }),
      lineBreaker: lineBreaker({ penalty: hyphenationPenalty }),
      justificationEngine: justificationEngine({ shrinkWhitespaceFactor })
    };

    super(engines);
  }
}

PNG.isValid = function (data) {
  try {
    return !!new PNG(data);
  } catch (e) {
    return false;
  }
};

// Extracted from https://github.com/devongovett/pdfkit/blob/master/lib/image/jpeg.coffee

const MARKERS = [0xffc0, 0xffc1, 0xffc2, 0xffc3, 0xffc5, 0xffc6, 0xffc7, 0xffc8, 0xffc9, 0xffca, 0xffcb, 0xffcc, 0xffcd, 0xffce, 0xffcf];

class JPEG {

  constructor(data) {
    this.data = null;
    this.width = null;
    this.height = null;

    this.data = data;

    if (data.readUInt16BE(0) !== 0xffd8) {
      throw new Error('SOI not found in JPEG');
    }

    let marker;
    let pos = 2;

    while (pos < data.length) {
      marker = data.readUInt16BE(pos);
      pos += 2;
      if (MARKERS.includes(marker)) {
        break;
      }
      pos += data.readUInt16BE(pos);
    }

    if (!MARKERS.includes(marker)) {
      throw new Error('Invalid JPEG.');
    }

    pos += 3;
    this.height = data.readUInt16BE(pos);

    pos += 2;
    this.width = data.readUInt16BE(pos);
  }
}

JPEG.isValid = function (data) {
  if (!data || !Buffer.isBuffer(data) || data.readUInt16BE(0) !== 0xffd8) {
    return false;
  }

  let marker;
  let pos = 2;

  while (pos < data.length) {
    marker = data.readUInt16BE(pos);
    pos += 2;
    if (MARKERS.includes(marker)) {
      break;
    }
    pos += data.readUInt16BE(pos);
  }

  if (!MARKERS.includes(marker)) {
    return false;
  }

  return true;
};

const createCache = ({ limit = 100 } = {}) => {
  const cache = {};
  const keys = [];

  return {
    get: key => cache[key],
    set: (key, value) => {
      keys.push(key);
      if (keys.length > limit) {
        delete cache[keys.shift()];
      }
      cache[key] = value;
    },
    length: () => keys.length
  };
};

const getAbsoluteLocalPath = src => {
  const { protocol, auth, host, port, hostname, path: pathname } = url.parse(src);
  const absolutePath = path.resolve(pathname);
  if (protocol && protocol !== 'file:' || auth || host || port || hostname) {
    return undefined;
  }
  return absolutePath;
};

const isDangerousLocalPath = (filename, { safePath = './public' } = {}) => {
  const absoluteSafePath = path.resolve(safePath);
  const absoluteFilePath = path.resolve(filename);
  return !absoluteFilePath.startsWith(absoluteSafePath);
};

const fetchLocalFile = (src, { safePath, allowDangerousPaths = false } = {}) => new _Promise((resolve, reject) => {
  try {
    const absolutePath = getAbsoluteLocalPath(src);
    if (!absolutePath) {
      return reject(new Error(`Cannot fetch non-local path: ${src}`));
    }
    if (!allowDangerousPaths && isDangerousLocalPath(absolutePath, { safePath })) {
      return reject(new Error(`Cannot fetch dangerous local path: ${src}`));
    }
    fs.readFile(absolutePath, (err, data) => {
      if (err) {
        return reject(err);
      }
      return resolve(data);
    });
  } catch (err) {
    reject(err);
  }
});

const imagesCache = createCache({ limit: 30 });

const isValidFormat = format => {
  const lower = format.toLowerCase();
  return lower === 'jpg' || lower === 'jpeg' || lower === 'png';
};

const guessFormat = buffer => {
  let format;

  if (JPEG.isValid(buffer)) {
    format = 'jpg';
  } else if (PNG.isValid(buffer)) {
    format = 'png';
  }

  return format;
};

const isCompatibleBase64 = src => /^data:image\/[a-zA-Z]*;base64,[^"]*/g.test(src);

function getImage(body, extension) {
  switch (extension.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return new JPEG(body);
    case 'png':
      return new PNG(body);
    default:
      return null;
  }
}

const resolveBase64Image = src => {
  const match = /^data:image\/([a-zA-Z]*);base64,([^"]*)/g.exec(src);
  const format = match[1];
  const data = match[2];

  if (!isValidFormat(format)) {
    throw new Error(`Base64 image invalid format: ${format}`);
  }

  return new _Promise(resolve => {
    return resolve(getImage(Buffer.from(data, 'base64'), format));
  });
};

const resolveImageFromData = src => {
  if (src.data && src.format) {
    return new _Promise(resolve => resolve(getImage(src.data, src.format)));
  }

  throw new Error(`Invalid data given for local file: ${_JSON$stringify(src)}`);
};

const resolveBufferImage = buffer => {
  const format = guessFormat(buffer);

  if (format) {
    return new _Promise(resolve => resolve(getImage(buffer, format)));
  }
};

const getImageFormat = body => {
  const isPng = body[0] === 137 && body[1] === 80 && body[2] === 78 && body[3] === 71 && body[4] === 13 && body[5] === 10 && body[6] === 26 && body[7] === 10;

  const isJpg = body[0] === 255 && body[1] === 216 && body[2] === 255;

  let extension = '';
  if (isPng) {
    extension = 'png';
  } else if (isJpg) {
    extension = 'jpg';
  } else {
    throw new Error('Not valid image extension');
  }

  return extension;
};

const resolveImageFromUrl = async (src, options) => {
  let body;
  if (!false && getAbsoluteLocalPath(src)) {
    body = await fetchLocalFile(src, options);
  } else {
    const response = await fetch(src);
    const buffer = await (response.buffer ? response.buffer() : response.arrayBuffer());
    body = await (buffer.constructor.name === 'Buffer' ? buffer : Buffer.from(buffer));
  }

  const extension = getImageFormat(body);

  return getImage(body, extension);
};

const resolveImage = (src, _ref = {}) => {
  let { cache = true } = _ref,
      options = _objectWithoutProperties(_ref, ['cache']);

  const cacheKey = src.data ? src.data.toString() : src;

  if (cache && imagesCache.get(cacheKey)) {
    return imagesCache.get(cacheKey);
  }

  let image;
  if (isCompatibleBase64(src)) {
    image = resolveBase64Image(src);
  } else if (Buffer.isBuffer(src)) {
    image = resolveBufferImage(src);
  } else if (typeof src === 'object' && src.data) {
    image = resolveImageFromData(src);
  } else {
    image = resolveImageFromUrl(src, options);
  }

  if (!image) {
    throw new Error('Cannot resolve image');
  }

  if (cache) {
    imagesCache.set(cacheKey, image);
  }

  return image;
};

/* eslint-disable no-cond-assign */
// Caches emoji images data
const emojis = {};
const regex = emojiRegex();

const reflect = promise => (...args) => promise(...args).then(v => v, e => e);

const fetchEmojiImage = reflect(resolveImage);

const getCodePoints = string => _Array$from(string).map(char => char.codePointAt(0).toString(16)).join('-');

const buildEmojiUrl = emoji => {
  const { url: url$$1, format } = Font.getEmojiSource();
  return `${url$$1}${getCodePoints(emoji)}.${format}`;
};

const fetchEmojis = string => {
  const emojiSource = Font.getEmojiSource();

  if (!emojiSource || !emojiSource.url) return [];

  const promises = [];

  let match;
  while (match = regex.exec(string)) {
    const emoji = match[0];

    if (!emojis[emoji] || emojis[emoji].loading) {
      const emojiUrl = buildEmojiUrl(emoji);

      emojis[emoji] = { loading: true };

      promises.push(fetchEmojiImage(emojiUrl).then(image => {
        emojis[emoji].loading = false;
        emojis[emoji].data = image.data;
      }));
    }
  }

  return promises;
};

const embedEmojis = fragments => {
  const result = [];

  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i];

    let match;
    let lastIndex = 0;

    while (match = regex.exec(fragment.string)) {
      const index = match.index;
      const emoji = match[0];
      const emojiSize = fragment.attributes.fontSize;
      const chunk = fragment.string.slice(lastIndex, index + match[0].length);

      // If emoji image was found, we create a new fragment with the
      // correct attachment and object substitution character;
      if (emojis[emoji] && emojis[emoji].data) {
        result.push({
          string: chunk.replace(match, Attachment.CHARACTER),
          attributes: _extends({}, fragment.attributes, {
            attachment: new Attachment(emojiSize, emojiSize, {
              yOffset: Math.floor(emojiSize * 0.1),
              image: emojis[emoji].data
            })
          })
        });
      } else {
        // If no emoji data, we just replace the emoji with a nodef char
        result.push({
          string: chunk.replace(match, String.fromCharCode(0)),
          attributes: fragment.attributes
        });
      }

      lastIndex = index + emoji.length;
    }

    if (lastIndex < fragment.string.length) {
      result.push({
        string: fragment.string.slice(lastIndex),
        attributes: fragment.attributes
      });
    }
  }

  return result;
};

class Document$1 {

  constructor(root, props) {
    this.root = root;
    this.props = props;
    this.children = [];
    this.subpages = [];
  }

  get name() {
    return 'Document';
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
  }

  removeChild(child) {
    const i = this.children.indexOf(child);
    child.parent = null;
    this.children.slice(i, 1);
  }

  addMetaData() {
    const { title, author, subject, keywords, creator, producer } = this.props;

    // The object keys need to start with a capital letter by the PDF spec
    if (title) this.root.instance.info.Title = title;
    if (author) this.root.instance.info.Author = author;
    if (subject) this.root.instance.info.Subject = subject;
    if (keywords) this.root.instance.info.Keywords = keywords;

    this.root.instance.info.Creator = creator || 'react-pdf';
    this.root.instance.info.Producer = producer || 'react-pdf';
  }

  async loadFonts() {
    const promises = [];
    const listToExplore = this.children.slice(0);

    while (listToExplore.length > 0) {
      const node = listToExplore.shift();

      if (node.style && node.style.fontFamily) {
        promises.push(Font.load(node.style.fontFamily, this.root.instance));
      }

      if (node.children) {
        node.children.forEach(childNode => {
          listToExplore.push(childNode);
        });
      }
    }

    await _Promise.all(promises);
  }

  async loadEmojis() {
    const promises = [];
    const listToExplore = this.children.slice(0);

    while (listToExplore.length > 0) {
      const node = listToExplore.shift();

      if (typeof node === 'string') {
        promises.push(...fetchEmojis(node));
      } else if (typeof node.value === 'string') {
        promises.push(...fetchEmojis(node.value));
      } else if (node.children) {
        node.children.forEach(childNode => {
          listToExplore.push(childNode);
        });
      }
    }

    await _Promise.all(promises);
  }

  async loadImages() {
    const promises = [];
    const listToExplore = this.children.slice(0);

    while (listToExplore.length > 0) {
      const node = listToExplore.shift();

      if (node.name === 'Image') {
        promises.push(node.fetch());
      }

      if (node.children) {
        node.children.forEach(childNode => {
          listToExplore.push(childNode);
        });
      }
    }

    await _Promise.all(promises);
  }

  async loadAssets() {
    await _Promise.all([this.loadFonts(), this.loadImages()]);
  }

  applyProps() {
    this.children.forEach(child => child.applyProps());
  }

  update(newProps) {
    this.props = newProps;
  }

  getLayoutData() {
    return {
      type: this.name,
      children: this.subpages.map(c => c.getLayoutData())
    };
  }

  async wrapPages() {
    let pageCount = 1;
    const pages = [];

    for (const page of this.children) {
      const wrapArea = page.size.height - (page.style.paddingBottom || 0);
      if (page.wrap) {
        const subpages = await wrapPages(page, wrapArea, pageCount);

        pageCount += subpages.length;

        pages.push(...subpages);
      } else {
        page.height = page.size.height;
        pages.push(page);
      }
    }

    return pages;
  }

  async renderPages() {
    this.subpages = await this.wrapPages();

    for (let j = 0; j < this.subpages.length; j++) {
      // Update dynamic text nodes with total pages info
      this.subpages[j].renderDynamicNodes({
        pageNumber: j + 1,
        totalPages: this.subpages.length
      }, node => node.name === 'Text');
      await this.subpages[j].render();
    }

    return this.subpages;
  }

  async render() {
    try {
      this.addMetaData();
      this.applyProps();
      await this.loadEmojis();
      await this.loadAssets();
      await this.renderPages();
      this.root.instance.end();
      Font.reset();
    } catch (e) {
      throw e;
    }
  }
}

Document$1.defaultProps = {
  author: null,
  keywords: null,
  subject: null,
  title: null
};

const upperFirst = value => value.charAt(0).toUpperCase() + value.slice(1);

const matchPercent = value => /(-?\d+\.?\d*)%/g.exec(value);

class Node$1 {
  constructor() {
    this.parent = null;
    this.children = [];
    this.computed = false;
    this.layout = Yoga.Node.createDefault();
  }

  appendChild(child) {
    if (child) {
      child.parent = this;
      this.children.push(child);
      this.layout.insertChild(child.layout, this.layout.getChildCount());
    }
  }

  appendChildBefore(child, beforeChild) {
    const index = this.children.indexOf(beforeChild);

    if (index !== -1 && child) {
      child.parent = this;
      this.children.splice(index, 0, child);
      this.layout.insertChild(child.layout, index);
    }
  }

  removeChild(child) {
    const index = this.children.indexOf(child);

    if (index !== -1) {
      child.parent = null;
      this.children.splice(index, 1);
      this.layout.removeChild(child.layout);
    }
  }

  removeAllChilds() {
    const children = [...this.children];
    for (let i = 0; i < children.length; i++) {
      children[i].remove();
    }
  }

  remove() {
    this.parent.removeChild(this);
  }

  setDimension(attr, value) {
    const fixedMethod = `set${upperFirst(attr)}`;
    const percentMethod = `${fixedMethod}Percent`;
    const isPercent = matchPercent(value);

    if (isPercent) {
      this.layout[percentMethod](parseFloat(isPercent[1], 10));
    } else {
      this.layout[fixedMethod](value);
    }
  }

  setPosition(edge, value) {
    const isPercent = matchPercent(value);

    if (isPercent) {
      this.layout.setPositionPercent(edge, parseFloat(isPercent[1], 10));
    } else {
      this.layout.setPosition(edge, value);
    }
  }

  setPadding(edge, value) {
    const isPercent = matchPercent(value);

    if (isPercent) {
      this.layout.setPaddingPercent(edge, parseFloat(isPercent[1], 10));
    } else {
      this.layout.setPadding(edge, value);
    }
  }

  setMargin(edge, value) {
    const isPercent = matchPercent(value);

    if (isPercent) {
      this.layout.setMarginPercent(edge, parseFloat(isPercent[1], 10));
    } else {
      this.layout.setMargin(edge, value);
    }
  }

  setBorder(edge, value) {
    if (matchPercent(value)) {
      throw new Error('Node: You cannot set percentage border widths');
    }
    this.layout.setBorder(edge, value);
  }

  getAbsoluteLayout() {
    const parent = this.parent;
    const parentLayout = parent && parent.getAbsoluteLayout ? parent.getAbsoluteLayout() : { left: 0, top: 0 };

    return {
      left: this.left + parentLayout.left,
      top: this.top + parentLayout.top,
      height: this.height,
      width: this.width
    };
  }

  copyStyle(node) {
    this.layout.copyStyle(node.layout);
  }

  calculateLayout() {
    this.layout.calculateLayout();
    this.computed = true;
  }

  isEmpty() {
    return this.children.length === 0;
  }

  markDirty() {
    return this.layout.markDirty();
  }

  onAppendDynamically() {}

  get position() {
    return this.layout.getPositionType() === Yoga.POSITION_TYPE_ABSOLUTE ? 'absolute' : 'relative';
  }

  get top() {
    return this.layout.getComputedTop() || 0;
  }

  get left() {
    return this.layout.getComputedLeft() || 0;
  }

  get right() {
    return this.layout.getComputedRight() || 0;
  }

  get bottom() {
    return this.layout.getComputedBottom() || 0;
  }

  get width() {
    return this.layout.getComputedWidth();
  }

  get minWidth() {
    return this.layout.getMinWidth().value;
  }

  get maxWidth() {
    return this.layout.getMaxWidth().value;
  }

  get height() {
    return this.layout.getComputedHeight();
  }

  get minHeight() {
    return this.layout.getMinHeight().value;
  }

  get maxHeight() {
    return this.layout.getMaxHeight().value;
  }

  get paddingTop() {
    return this.layout.getComputedPadding(Yoga.EDGE_TOP) || 0;
  }

  get paddingRight() {
    return this.layout.getComputedPadding(Yoga.EDGE_RIGHT) || 0;
  }

  get paddingBottom() {
    return this.layout.getComputedPadding(Yoga.EDGE_BOTTOM) || 0;
  }

  get paddingLeft() {
    return this.layout.getComputedPadding(Yoga.EDGE_LEFT) || 0;
  }

  get marginTop() {
    return this.layout.getComputedMargin(Yoga.EDGE_TOP) || 0;
  }

  get marginRight() {
    return this.layout.getComputedMargin(Yoga.EDGE_RIGHT) || 0;
  }

  get marginBottom() {
    return this.layout.getComputedMargin(Yoga.EDGE_BOTTOM) || 0;
  }

  get marginLeft() {
    return this.layout.getComputedMargin(Yoga.EDGE_LEFT) || 0;
  }

  get borderTopWidth() {
    return this.layout.getComputedBorder(Yoga.EDGE_TOP) || 0;
  }

  get borderRightWidth() {
    return this.layout.getComputedBorder(Yoga.EDGE_RIGHT) || 0;
  }

  get borderBottomWidth() {
    return this.layout.getComputedBorder(Yoga.EDGE_BOTTOM) || 0;
  }

  get borderLeftWidth() {
    return this.layout.getComputedBorder(Yoga.EDGE_LEFT) || 0;
  }

  get padding() {
    return {
      top: this.paddingTop,
      right: this.paddingRight,
      bottom: this.paddingBottom,
      left: this.paddingLeft
    };
  }

  get margin() {
    return {
      top: this.marginTop,
      right: this.marginRight,
      bottom: this.marginBottom,
      left: this.marginLeft
    };
  }

  set position(value) {
    this.layout.setPositionType(value === 'absolute' ? Yoga.POSITION_TYPE_ABSOLUTE : Yoga.POSITION_TYPE_RELATIVE);
  }

  set top(value) {
    this.setPosition(Yoga.EDGE_TOP, value);
  }

  set left(value) {
    this.setPosition(Yoga.EDGE_LEFT, value);
  }

  set right(value) {
    this.setPosition(Yoga.EDGE_RIGHT, value);
  }

  set bottom(value) {
    this.setPosition(Yoga.EDGE_BOTTOM, value);
  }

  set width(value) {
    this.setDimension('width', value);
  }

  set minWidth(value) {
    this.setDimension('minWidth', value);
  }

  set maxWidth(value) {
    this.setDimension('maxWidth', value);
  }

  set height(value) {
    this.setDimension('height', value);
  }

  set minHeight(value) {
    this.setDimension('minHeight', value);
  }

  set maxHeight(value) {
    this.setDimension('maxHeight', value);
  }

  set paddingTop(value) {
    this.setPadding(Yoga.EDGE_TOP, value);
  }

  set paddingRight(value) {
    this.setPadding(Yoga.EDGE_RIGHT, value);
  }

  set paddingBottom(value) {
    this.setPadding(Yoga.EDGE_BOTTOM, value);
  }

  set paddingLeft(value) {
    this.setPadding(Yoga.EDGE_LEFT, value);
  }

  set marginTop(value) {
    this.setMargin(Yoga.EDGE_TOP, value);
  }

  set marginRight(value) {
    this.setMargin(Yoga.EDGE_RIGHT, value);
  }

  set marginBottom(value) {
    this.setMargin(Yoga.EDGE_BOTTOM, value);
  }

  set marginLeft(value) {
    this.setMargin(Yoga.EDGE_LEFT, value);
  }

  set padding(value) {
    this.paddingTop = value;
    this.paddingRight = value;
    this.paddingBottom = value;
    this.paddingLeft = value;
  }

  set margin(value) {
    this.marginTop = value;
    this.marginRight = value;
    this.marginBottom = value;
    this.marginLeft = value;
  }

  set borderTopWidth(value) {
    this.setBorder(Yoga.EDGE_TOP, value);
  }

  set borderRightWidth(value) {
    this.setBorder(Yoga.EDGE_RIGHT, value);
  }

  set borderBottomWidth(value) {
    this.setBorder(Yoga.EDGE_BOTTOM, value);
  }

  set borderLeftWidth(value) {
    this.setBorder(Yoga.EDGE_LEFT, value);
  }
}

const yogaValue = (prop, value) => {
  const isAlignType = prop => prop === 'alignItems' || prop === 'alignContent' || prop === 'alignSelf';

  switch (value) {
    case 'auto':
      if (prop === 'alignSelf') {
        return Yoga.ALIGN_AUTO;
      }
      break;
    case 'flex':
      return Yoga.DISPLAY_FLEX;
    case 'none':
      return Yoga.DISPLAY_NONE;
    case 'row':
      return Yoga.FLEX_DIRECTION_ROW;
    case 'row-reverse':
      return Yoga.FLEX_DIRECTION_ROW_REVERSE;
    case 'column':
      return Yoga.FLEX_DIRECTION_COLUMN;
    case 'column-reverse':
      return Yoga.FLEX_DIRECTION_COLUMN_REVERSE;
    case 'stretch':
      return Yoga.ALIGN_STRETCH;
    case 'baseline':
      return Yoga.ALIGN_BASELINE;
    case 'space-around':
      if (prop === 'justifyContent') {
        return Yoga.JUSTIFY_SPACE_AROUND;
      } else if (isAlignType(prop)) {
        return Yoga.ALIGN_SPACE_AROUND;
      }
      break;
    case 'space-between':
      if (prop === 'justifyContent') {
        return Yoga.JUSTIFY_SPACE_BETWEEN;
      } else if (isAlignType(prop)) {
        return Yoga.ALIGN_SPACE_BETWEEN;
      }
      break;
    case 'around':
      return Yoga.JUSTIFY_SPACE_AROUND;
    case 'between':
      return Yoga.JUSTIFY_SPACE_BETWEEN;
    case 'wrap':
      return Yoga.WRAP_WRAP;
    case 'wrap-reverse':
      return Yoga.WRAP_WRAP_REVERSE;
    case 'nowrap':
      return Yoga.WRAP_NO_WRAP;
    case 'flex-start':
      if (prop === 'justifyContent') {
        return Yoga.JUSTIFY_FLEX_START;
      } else if (isAlignType(prop)) {
        return Yoga.ALIGN_FLEX_START;
      }
      break;
    case 'flex-end':
      if (prop === 'justifyContent') {
        return Yoga.JUSTIFY_FLEX_END;
      } else if (isAlignType(prop)) {
        return Yoga.ALIGN_FLEX_END;
      }
      break;
    case 'center':
      if (prop === 'justifyContent') {
        return Yoga.JUSTIFY_CENTER;
      } else if (isAlignType(prop)) {
        return Yoga.ALIGN_CENTER;
      }
      break;
    default:
      return value;
  }
};

const parseValue = value => {
  const match = /^(\d*\.?\d+)(in|mm|cm|pt)?$/g.exec(value);

  if (match) {
    return { value: parseFloat(match[1], 10), unit: match[2] || 'pt' };
  } else {
    return { value, unit: undefined };
  }
};

const parseScalar = value => {
  let result = {};
  const scalar = parseValue(value);

  switch (scalar.unit) {
    case 'in':
      result = scalar.value * 72;
      break;
    case 'mm':
      result = scalar.value * (1 / 25.4) * 72;
      break;
    case 'cm':
      result = scalar.value * (1 / 2.54) * 72;
      break;
    default:
      result = scalar.value;
  }

  return result;
};

const hasOwnProperty = Object.prototype.hasOwnProperty;

const styleShortHands = {
  margin: {
    marginTop: true,
    marginRight: true,
    marginBottom: true,
    marginLeft: true
  },
  marginHorizontal: {
    marginLeft: true,
    marginRight: true
  },
  marginVertical: {
    marginTop: true,
    marginBottom: true
  },
  padding: {
    paddingTop: true,
    paddingRight: true,
    paddingBottom: true,
    paddingLeft: true
  },
  paddingHorizontal: {
    paddingLeft: true,
    paddingRight: true
  },
  paddingVertical: {
    paddingTop: true,
    paddingBottom: true
  },
  border: {
    borderTopColor: true,
    borderTopStyle: true,
    borderTopWidth: true,
    borderRightColor: true,
    borderRightStyle: true,
    borderRightWidth: true,
    borderBottomColor: true,
    borderBottomStyle: true,
    borderBottomWidth: true,
    borderLeftColor: true,
    borderLeftStyle: true,
    borderLeftWidth: true
  },
  borderTop: {
    borderTopColor: true,
    borderTopStyle: true,
    borderTopWidth: true
  },
  borderRight: {
    borderRightColor: true,
    borderRightStyle: true,
    borderRightWidth: true
  },
  borderBottom: {
    borderBottomColor: true,
    borderBottomStyle: true,
    borderBottomWidth: true
  },
  borderLeft: {
    borderLeftColor: true,
    borderLeftStyle: true,
    borderLeftWidth: true
  },
  borderColor: {
    borderTopColor: true,
    borderRightColor: true,
    borderBottomColor: true,
    borderLeftColor: true
  },
  borderRadius: {
    borderTopLeftRadius: true,
    borderTopRightRadius: true,
    borderBottomRightRadius: true,
    borderBottomLeftRadius: true
  },
  borderStyle: {
    borderTopStyle: true,
    borderRightStyle: true,
    borderBottomStyle: true,
    borderLeftStyle: true
  },
  borderWidth: {
    borderTopWidth: true,
    borderRightWidth: true,
    borderBottomWidth: true,
    borderLeftWidth: true
  }
};

// Expand the shorthand properties to isolate every declaration from the others.
const expandStyles = style => {
  if (!style) return style;

  const propsArray = _Object$keys(style);
  const resolvedStyle = {};

  for (let i = 0; i < propsArray.length; i++) {
    const key = propsArray[i];
    const value = style[key];

    switch (key) {
      case 'display':
      case 'flex':
      case 'flexDirection':
      case 'flexWrap':
      case 'flexFlow':
      case 'flexGrow':
      case 'flexShrink':
      case 'flexBasis':
      case 'justifyContent':
      case 'alignSelf':
      case 'alignItems':
      case 'alignContent':
      case 'order':
        resolvedStyle[key] = yogaValue(key, value);
        break;
      case 'textAlignVertical':
        resolvedStyle.verticalAlign = value === 'center' ? 'middle' : value;
        break;
      case 'margin':
      case 'marginHorizontal':
      case 'marginVertical':
      case 'padding':
      case 'paddingHorizontal':
      case 'paddingVertical':
      case 'border':
      case 'borderTop':
      case 'borderRight':
      case 'borderBottom':
      case 'borderLeft':
      case 'borderColor':
      case 'borderRadius':
      case 'borderStyle':
      case 'borderWidth':
        {
          const expandedProps = styleShortHands[key];
          for (const propName in expandedProps) {
            if (hasOwnProperty.call(expandedProps, propName)) {
              resolvedStyle[propName] = value;
            }
          }
        }
        break;
      default:
        resolvedStyle[key] = value;
        break;
    }
  }

  return resolvedStyle;
};

const matchBorderShorthand = value => value.match(/(\d+(px|in|mm|cm|pt)?)\s(\S+)\s(\S+)/);

// Transforms shorthand border values to correct value
const processBorders = (key, value) => {
  const match = matchBorderShorthand(value);

  if (match) {
    if (key.match(/.Color/)) {
      return match[4];
    } else if (key.match(/.Style/)) {
      return match[3];
    } else if (key.match(/.Width/)) {
      return match[1];
    } else {
      throw new Error(`StyleSheet: Invalid '${value}' for '${key}'`);
    }
  }

  return value;
};

const transformStyles = style => {
  const expandedStyles = expandStyles(style);
  const propsArray = _Object$keys(expandedStyles);
  const resolvedStyle = {};

  for (let i = 0; i < propsArray.length; i++) {
    const key = propsArray[i];
    const value = expandedStyles[key];
    const isBorderStyle = key.match(/border/) && typeof value === 'string';
    const resolved = isBorderStyle ? processBorders(key, value) : value;

    resolvedStyle[key] = parseScalar(resolved);
  }

  return resolvedStyle;
};

const create = styles => styles;

const flatten = input => {
  if (!Array.isArray(input)) {
    input = [input];
  }

  const result = input.reduce((acc, style) => {
    if (style) {
      _Object$keys(style).forEach(key => {
        if (style[key] !== null && style[key] !== undefined) {
          acc[key] = style[key];
        }
      });
    }

    return acc;
  }, {});

  return result;
};

const resolveMediaQueries = (input, container) => {
  const result = _Object$keys(input).reduce((acc, key) => {
    if (/@media/.test(key)) {
      return _extends({}, acc, matchMedia({ [key]: input[key] }, container));
    }

    return _extends({}, acc, { [key]: input[key] });
  }, {});

  return result;
};

const resolve = (styles, container) => {
  if (!styles) return null;

  styles = flatten(styles);
  styles = resolveMediaQueries(styles, container);
  styles = transformStyles(styles);

  return styles;
};

const absoluteFillObject = {
  position: 'absolute',
  top: 0,
  left: 0,
  bottom: 0,
  right: 0
};

var StyleSheet = {
  hairlineWidth: 1,
  create,
  resolve,
  flatten,
  absoluteFillObject
};

const Debug = {
  debug() {
    const layout = this.getAbsoluteLayout();
    const padding = this.padding;
    const margin = this.margin;

    this.root.instance.save();

    this.debugContent(layout, margin, padding);
    this.debugPadding(layout, margin, padding);
    this.debugMargin(layout, margin);
    this.debugText(layout, margin);

    this.root.instance.restore();
  },
  debugText(layout, margin) {
    const roundedWidth = Math.round(this.width + margin.left + margin.right);
    const roundedHeight = Math.round(this.height + margin.top + margin.bottom);

    this.root.instance.fontSize(4).opacity(1).fillColor('black').text(`${roundedWidth} x ${roundedHeight}`, layout.left - margin.left, Math.max(layout.top - margin.top - 4, 1));
  },
  debugContent(layout, margin, padding) {
    this.root.instance.fillColor('#a1c6e7').opacity(0.5).rect(layout.left + padding.left, layout.top + padding.top, layout.width - padding.left - padding.right, layout.height - padding.top - padding.bottom).fill();
  },
  debugPadding(layout, margin, padding) {
    this.root.instance.fillColor('#c4deb9').opacity(0.5);

    // Padding top
    this.root.instance.rect(layout.left + padding.left, layout.top, layout.width - padding.right - padding.left, padding.top).fill();

    // Padding left
    this.root.instance.rect(layout.left, layout.top, padding.left, layout.height).fill();

    // Padding right
    this.root.instance.rect(layout.left + layout.width - padding.right, layout.top, padding.right, layout.height).fill();

    // Padding bottom
    this.root.instance.rect(layout.left + padding.left, layout.top + layout.height - padding.bottom, layout.width - padding.right - padding.left, padding.bottom).fill();
  },
  debugMargin(layout, margin) {
    this.root.instance.fillColor('#f8cca1').opacity(0.5);

    // Margin top
    this.root.instance.rect(layout.left, layout.top - margin.top, layout.width, margin.top).fill();

    // Margin left
    this.root.instance.rect(layout.left - margin.left, layout.top - margin.top, margin.left, layout.height + margin.top + margin.bottom).fill();

    // Margin right
    this.root.instance.rect(layout.left + layout.width, layout.top - margin.top, margin.right, layout.height + margin.top + margin.bottom).fill();

    // Margin bottom
    this.root.instance.rect(layout.left, layout.top + layout.height, layout.width, margin.bottom).fill();
  }
};

// Ref: https://www.w3.org/TR/css-backgrounds-3/#borders

// This constant is used to approximate a symmetrical arc using a cubic Bezier curve.
const KAPPA = 4.0 * ((Math.sqrt(2) - 1.0) / 3.0);

function drawBorders() {
  const { instance } = this.root;
  const layout = this.getAbsoluteLayout();

  const {
    borderTopWidth,
    borderLeftWidth,
    borderRightWidth,
    borderBottomWidth
  } = this;

  const {
    borderTopLeftRadius = 0,
    borderTopRightRadius = 0,
    borderBottomLeftRadius = 0,
    borderBottomRightRadius = 0,
    borderTopColor = 'black',
    borderTopStyle = 'solid',
    borderLeftColor = 'black',
    borderLeftStyle = 'solid',
    borderRightColor = 'black',
    borderRightStyle = 'solid',
    borderBottomColor = 'black',
    borderBottomStyle = 'solid'
  } = this.getComputedStyles();

  const style = {
    borderTopColor,
    borderTopWidth,
    borderTopStyle,
    borderLeftColor,
    borderLeftWidth,
    borderLeftStyle,
    borderRightColor,
    borderRightWidth,
    borderRightStyle,
    borderBottomColor,
    borderBottomWidth,
    borderBottomStyle,
    borderTopLeftRadius,
    borderTopRightRadius,
    borderBottomLeftRadius,
    borderBottomRightRadius
  };

  const { width, height } = layout;
  const rtr = Math.min(borderTopRightRadius, 0.5 * width, 0.5 * height);
  const rtl = Math.min(borderTopLeftRadius, 0.5 * width, 0.5 * height);
  const rbr = Math.min(borderBottomRightRadius, 0.5 * width, 0.5 * height);
  const rbl = Math.min(borderBottomLeftRadius, 0.5 * width, 0.5 * height);

  instance.save();

  if (borderTopWidth) {
    instance.save();
    clipBorderTop(instance, layout, style, rtr, rtl);
    fillBorderTop(instance, layout, style, rtr, rtl);
    instance.restore();
  }

  if (borderRightWidth) {
    instance.save();
    clipBorderRight(instance, layout, style, rtr, rbr);
    fillBorderRight(instance, layout, style, rtr, rbr);
    instance.restore();
  }

  if (borderBottomWidth) {
    instance.save();
    clipBorderBottom(instance, layout, style, rbl, rbr);
    fillBorderBottom(instance, layout, style, rbl, rbr);
    instance.restore();
  }

  if (borderLeftWidth) {
    instance.save();
    clipBorderLeft(instance, layout, style, rbl, rtl);
    fillBorderLeft(instance, layout, style, rbl, rtl);
    instance.restore();
  }

  instance.restore();
}

const clipBorderTop = (ctx, layout, style, rtr, rtl) => {
  const { top, left, width, height } = layout;
  const { borderTopWidth, borderRightWidth, borderLeftWidth } = style;

  // Clip outer top border edge
  ctx.moveTo(left + rtl, top);
  ctx.lineTo(left + width - rtr, top);

  // Ellipse coefficients outer top right cap
  const c0 = rtr * (1.0 - KAPPA);

  // Clip outer top right cap
  ctx.bezierCurveTo(left + width - c0, top, left + width, top + c0, left + width, top + rtr);

  // Move down in case the margin exceedes the radius
  const topRightYCoord = top + Math.max(borderTopWidth, rtr);
  ctx.lineTo(left + width, topRightYCoord);

  // Clip inner top right cap
  ctx.lineTo(left + width - borderRightWidth, topRightYCoord);

  // Ellipse coefficients inner top right cap
  const innerTopRightRadiusX = Math.max(rtr - borderRightWidth, 0);
  const innerTopRightRadiusY = Math.max(rtr - borderTopWidth, 0);
  const c1 = innerTopRightRadiusX * (1.0 - KAPPA);
  const c2 = innerTopRightRadiusY * (1.0 - KAPPA);

  // Clip inner top right cap
  ctx.bezierCurveTo(left + width - borderRightWidth, top + borderTopWidth + c2, left + width - borderRightWidth - c1, top + borderTopWidth, left + width - borderRightWidth - innerTopRightRadiusX, top + borderTopWidth);

  // Clip inner top border edge
  ctx.lineTo(left + Math.max(rtl, borderLeftWidth), top + borderTopWidth);

  // Ellipse coefficients inner top left cap
  const innerTopLeftRadiusX = Math.max(rtl - borderLeftWidth, 0);
  const innerTopLeftRadiusY = Math.max(rtl - borderTopWidth, 0);
  const c3 = innerTopLeftRadiusX * (1.0 - KAPPA);
  const c4 = innerTopLeftRadiusY * (1.0 - KAPPA);
  const topLeftYCoord = top + Math.max(borderTopWidth, rtl);

  // Clip inner top left cap
  ctx.bezierCurveTo(left + borderLeftWidth + c3, top + borderTopWidth, left + borderLeftWidth, top + borderTopWidth + c4, left + borderLeftWidth, topLeftYCoord);
  ctx.lineTo(left, topLeftYCoord);

  // Move down in case the margin exceedes the radius
  ctx.lineTo(left, top + rtl);

  // Ellipse coefficients outer top left cap
  const c5 = rtl * (1.0 - KAPPA);

  // Clip outer top left cap
  ctx.bezierCurveTo(left, top + c5, left + c5, top, left + rtl, top);
  ctx.closePath();
  ctx.clip();

  // Clip border top cap joins
  if (borderRightWidth) {
    const trSlope = -borderTopWidth / borderRightWidth;
    ctx.moveTo(left + width / 2, trSlope * (-width / 2) + top);
    ctx.lineTo(left + width, top);
    ctx.lineTo(left, top);
    ctx.lineTo(left, top + height);
    ctx.closePath();
    ctx.clip();
  }

  if (borderLeftWidth) {
    const trSlope = -borderTopWidth / borderLeftWidth;
    ctx.moveTo(left + width / 2, trSlope * (-width / 2) + top);
    ctx.lineTo(left, top);
    ctx.lineTo(left + width, top);
    ctx.lineTo(left + width, top + height);
    ctx.closePath();
    ctx.clip();
  }
};

const fillBorderTop = (ctx, layout, style, rtr, rtl) => {
  const { top, left, width } = layout;
  const {
    borderTopColor,
    borderTopWidth,
    borderTopStyle,
    borderRightWidth,
    borderLeftWidth
  } = style;

  const c0 = rtl * (1.0 - KAPPA);
  const c1 = rtr * (1.0 - KAPPA);

  ctx.moveTo(left, top + Math.max(rtl, borderTopWidth));
  ctx.bezierCurveTo(left, top + c0, left + c0, top, left + rtl, top);
  ctx.lineTo(left + width - rtr, top);
  ctx.bezierCurveTo(left + width - c1, top, left + width, top + c1, left + width, top + rtr);

  ctx.strokeColor(borderTopColor);
  ctx.lineWidth(Math.max(borderRightWidth, borderTopWidth, borderLeftWidth) * 2);

  if (borderTopStyle === 'dashed') {
    ctx.dash(borderTopWidth * 2, { space: borderTopWidth * 1.2 });
  } else if (borderTopStyle === 'dotted') {
    ctx.dash(borderTopWidth, { space: borderTopWidth * 1.2 });
  }

  ctx.stroke();
  ctx.undash();
};

const clipBorderRight = (ctx, layout, style, rtr, rbr) => {
  const { top, left, width, height } = layout;
  const { borderTopWidth, borderRightWidth, borderBottomWidth } = style;

  // Clip outer right border edge
  ctx.moveTo(left + width, top + rtr);
  ctx.lineTo(left + width, top + height - rbr);

  // Ellipse coefficients outer bottom right cap
  const c0 = rbr * (1.0 - KAPPA);

  // Clip outer top right cap
  ctx.bezierCurveTo(left + width, top + height - c0, left + width - c0, top + height, left + width - rbr, top + height);

  // Move left in case the margin exceedes the radius
  const topBottomXCoord = left + width - Math.max(borderRightWidth, rbr);
  ctx.lineTo(topBottomXCoord, top + height);

  // Clip inner bottom right cap
  ctx.lineTo(topBottomXCoord, top + height - borderBottomWidth);

  // Ellipse coefficients inner bottom right cap
  const innerBottomRightRadiusX = Math.max(rbr - borderRightWidth, 0);
  const innerBottomRightRadiusY = Math.max(rbr - borderBottomWidth, 0);
  const c1 = innerBottomRightRadiusX * (1.0 - KAPPA);
  const c2 = innerBottomRightRadiusY * (1.0 - KAPPA);

  // Clip inner top right cap
  ctx.bezierCurveTo(left + width - borderRightWidth - c1, top + height - borderBottomWidth, left + width - borderRightWidth, top + height - borderBottomWidth - c2, left + width - borderRightWidth, top + height - Math.max(rbr, borderBottomWidth));

  // Clip inner right border edge
  ctx.lineTo(left + width - borderRightWidth, top + Math.max(rtr, borderTopWidth));

  // Ellipse coefficients inner top right cap
  const innerTopRightRadiusX = Math.max(rtr - borderRightWidth, 0);
  const innerTopRightRadiusY = Math.max(rtr - borderTopWidth, 0);
  const c3 = innerTopRightRadiusX * (1.0 - KAPPA);
  const c4 = innerTopRightRadiusY * (1.0 - KAPPA);
  const topRightXCoord = left + width - Math.max(rtr, borderRightWidth);

  // Clip inner top left cap
  ctx.bezierCurveTo(left + width - borderRightWidth, top + borderTopWidth + c4, left + width - borderRightWidth - c3, top + borderTopWidth, topRightXCoord, top + borderTopWidth);
  ctx.lineTo(topRightXCoord, top);

  // Move right in case the margin exceedes the radius
  ctx.lineTo(left + width - rtr, top);

  // Ellipse coefficients outer top right cap
  const c5 = rtr * (1.0 - KAPPA);

  // Clip outer top right cap
  ctx.bezierCurveTo(left + width - c5, top, left + width, top + c5, left + width, top + rtr);

  ctx.closePath();
  ctx.clip();

  // Clip border right cap joins
  if (borderTopWidth) {
    const trSlope = -borderTopWidth / borderRightWidth;
    ctx.moveTo(left + width / 2, trSlope * (-width / 2) + top);
    ctx.lineTo(left + width, top);
    ctx.lineTo(left + width, top + height);
    ctx.lineTo(left, top + height);
    ctx.closePath();
    ctx.clip();
  }

  if (borderBottomWidth) {
    const brSlope = borderBottomWidth / borderRightWidth;
    ctx.moveTo(left + width / 2, brSlope * (-width / 2) + top + height);
    ctx.lineTo(left + width, top + height);
    ctx.lineTo(left + width, top);
    ctx.lineTo(left, top);
    ctx.closePath();
    ctx.clip();
  }
};

const fillBorderRight = (ctx, layout, style, rtr, rbr) => {
  const { top, left, width, height } = layout;
  const {
    borderRightColor,
    borderRightStyle,
    borderRightWidth,
    borderTopWidth,
    borderBottomWidth
  } = style;

  const c0 = rbr * (1.0 - KAPPA);
  const c1 = rtr * (1.0 - KAPPA);

  ctx.moveTo(left + width - rtr, top);
  ctx.bezierCurveTo(left + width - c1, top, left + width, top + c1, left + width, top + rtr);
  ctx.lineTo(left + width, top + height - rbr);
  ctx.bezierCurveTo(left + width, top + height - c0, left + width - c0, top + height, left + width - rbr, top + height);

  ctx.strokeColor(borderRightColor);
  ctx.lineWidth(Math.max(borderRightWidth, borderTopWidth, borderBottomWidth) * 2);

  if (borderRightStyle === 'dashed') {
    ctx.dash(borderRightWidth * 2, { space: borderRightWidth * 1.2 });
  } else if (borderRightStyle === 'dotted') {
    ctx.dash(borderRightWidth, { space: borderRightWidth * 1.2 });
  }

  ctx.stroke();
  ctx.undash();
};

const clipBorderBottom = (ctx, layout, style, rbl, rbr) => {
  const { top, left, width, height } = layout;
  const { borderBottomWidth, borderRightWidth, borderLeftWidth } = style;

  // Clip outer top border edge
  ctx.moveTo(left + width - rbr, top + height);
  ctx.lineTo(left + rbl, top + height);

  // Ellipse coefficients outer top right cap
  const c0 = rbl * (1.0 - KAPPA);

  // Clip outer top right cap
  ctx.bezierCurveTo(left + c0, top + height, left, top + height - c0, left, top + height - rbl);

  // Move up in case the margin exceedes the radius
  const bottomLeftYCoord = top + height - Math.max(borderBottomWidth, rbl);
  ctx.lineTo(left, bottomLeftYCoord);

  // Clip inner bottom left cap
  ctx.lineTo(left + borderLeftWidth, bottomLeftYCoord);

  // Ellipse coefficients inner top right cap
  const innerBottomLeftRadiusX = Math.max(rbl - borderLeftWidth, 0);
  const innerBottomLeftRadiusY = Math.max(rbl - borderBottomWidth, 0);
  const c1 = innerBottomLeftRadiusX * (1.0 - KAPPA);
  const c2 = innerBottomLeftRadiusY * (1.0 - KAPPA);

  // Clip inner bottom left cap
  ctx.bezierCurveTo(left + borderLeftWidth, top + height - borderBottomWidth - c2, left + borderLeftWidth + c1, top + height - borderBottomWidth, left + borderLeftWidth + innerBottomLeftRadiusX, top + height - borderBottomWidth);

  // Clip inner bottom border edge
  ctx.lineTo(left + width - Math.max(rbr, borderRightWidth), top + height - borderBottomWidth);

  // Ellipse coefficients inner top left cap
  const innerBottomRightRadiusX = Math.max(rbr - borderRightWidth, 0);
  const innerBottomRightRadiusY = Math.max(rbr - borderBottomWidth, 0);
  const c3 = innerBottomRightRadiusX * (1.0 - KAPPA);
  const c4 = innerBottomRightRadiusY * (1.0 - KAPPA);
  const bottomRightYCoord = top + height - Math.max(borderBottomWidth, rbr);

  // Clip inner top left cap
  ctx.bezierCurveTo(left + width - borderRightWidth - c3, top + height - borderBottomWidth, left + width - borderRightWidth, top + height - borderBottomWidth - c4, left + width - borderRightWidth, bottomRightYCoord);
  ctx.lineTo(left + width, bottomRightYCoord);

  // Move down in case the margin exceedes the radius
  ctx.lineTo(left + width, top + height - rbr);

  // Ellipse coefficients outer top left cap
  const c5 = rbr * (1.0 - KAPPA);

  // Clip outer top left cap
  ctx.bezierCurveTo(left + width, top + height - c5, left + width - c5, top + height, left + width - rbr, top + height);
  ctx.closePath();
  ctx.clip();

  // Clip border bottom cap joins
  if (borderRightWidth) {
    const brSlope = borderBottomWidth / borderRightWidth;
    ctx.moveTo(left + width / 2, brSlope * (-width / 2) + top + height);
    ctx.lineTo(left + width, top + height);
    ctx.lineTo(left, top + height);
    ctx.lineTo(left, top);
    ctx.closePath();
    ctx.clip();
  }

  if (borderLeftWidth) {
    const trSlope = -borderBottomWidth / borderLeftWidth;
    ctx.moveTo(left + width / 2, trSlope * (width / 2) + top + height);
    ctx.lineTo(left, top + height);
    ctx.lineTo(left + width, top + height);
    ctx.lineTo(left + width, top);
    ctx.closePath();
    ctx.clip();
  }
};

const fillBorderBottom = (ctx, layout, style, rbl, rbr) => {
  const { top, left, width, height } = layout;
  const {
    borderBottomColor,
    borderBottomStyle,
    borderBottomWidth,
    borderRightWidth,
    borderLeftWidth
  } = style;

  const c0 = rbl * (1.0 - KAPPA);
  const c1 = rbr * (1.0 - KAPPA);

  ctx.moveTo(left + width, top + height - rbr);
  ctx.bezierCurveTo(left + width, top + height - c1, left + width - c1, top + height, left + width - rbr, top + height);
  ctx.lineTo(left + rbl, top + height);
  ctx.bezierCurveTo(left + c0, top + height, left, top + height - c0, left, top + height - rbl);

  ctx.strokeColor(borderBottomColor);
  ctx.lineWidth(Math.max(borderBottomWidth, borderRightWidth, borderLeftWidth) * 2);

  if (borderBottomStyle === 'dashed') {
    ctx.dash(borderBottomWidth * 2, { space: borderBottomWidth * 1.2 });
  } else if (borderBottomStyle === 'dotted') {
    ctx.dash(borderBottomWidth, { space: borderBottomWidth * 1.2 });
  }

  ctx.stroke();
  ctx.undash();
};

const clipBorderLeft = (ctx, layout, style, rbl, rtl) => {
  const { top, left, width, height } = layout;
  const { borderTopWidth, borderLeftWidth, borderBottomWidth } = style;

  // Clip outer left border edge
  ctx.moveTo(left, top + height - rbl);
  ctx.lineTo(left, top + rtl);

  // Ellipse coefficients outer top left cap
  const c0 = rtl * (1.0 - KAPPA);

  // Clip outer top left cap
  ctx.bezierCurveTo(left, top + c0, left + c0, top, left + rtl, top);

  // Move right in case the margin exceedes the radius
  const topLeftCoordX = left + Math.max(borderLeftWidth, rtl);
  ctx.lineTo(topLeftCoordX, top);

  // Clip inner top left cap
  ctx.lineTo(topLeftCoordX, top + borderTopWidth);

  // Ellipse coefficients inner top left cap
  const innerTopLeftRadiusX = Math.max(rtl - borderLeftWidth, 0);
  const innerTopLeftRadiusY = Math.max(rtl - borderTopWidth, 0);
  const c1 = innerTopLeftRadiusX * (1.0 - KAPPA);
  const c2 = innerTopLeftRadiusY * (1.0 - KAPPA);

  // Clip inner top right cap
  ctx.bezierCurveTo(left + borderLeftWidth + c1, top + borderTopWidth, left + borderLeftWidth, top + borderTopWidth + c2, left + borderLeftWidth, top + Math.max(rtl, borderTopWidth));

  // Clip inner left border edge
  ctx.lineTo(left + borderLeftWidth, top + height - Math.max(rbl, borderBottomWidth));

  // Ellipse coefficients inner bottom left cap
  const innerBottomLeftRadiusX = Math.max(rbl - borderLeftWidth, 0);
  const innerBottomLeftRadiusY = Math.max(rbl - borderBottomWidth, 0);
  const c3 = innerBottomLeftRadiusX * (1.0 - KAPPA);
  const c4 = innerBottomLeftRadiusY * (1.0 - KAPPA);
  const bottomLeftXCoord = left + Math.max(rbl, borderLeftWidth);

  // Clip inner top left cap
  ctx.bezierCurveTo(left + borderLeftWidth, top + height - borderBottomWidth - c4, left + borderLeftWidth + c3, top + height - borderBottomWidth, bottomLeftXCoord, top + height - borderBottomWidth);
  ctx.lineTo(bottomLeftXCoord, top + height);

  // Move left in case the margin exceedes the radius
  ctx.lineTo(left + rbl, top + height);

  // Ellipse coefficients outer top right cap
  const c5 = rbl * (1.0 - KAPPA);

  // Clip outer top right cap
  ctx.bezierCurveTo(left + c5, top + height, left, top + height - c5, left, top + height - rbl);

  ctx.closePath();
  ctx.clip();

  // Clip border right cap joins
  if (borderBottomWidth) {
    const trSlope = -borderBottomWidth / borderLeftWidth;
    ctx.moveTo(left + width / 2, trSlope * (width / 2) + top + height);
    ctx.lineTo(left, top + height);
    ctx.lineTo(left, top);
    ctx.lineTo(left + width, top);
    ctx.closePath();
    ctx.clip();
  }

  if (borderBottomWidth) {
    const trSlope = -borderTopWidth / borderLeftWidth;
    ctx.moveTo(left + width / 2, trSlope * (-width / 2) + top);
    ctx.lineTo(left, top);
    ctx.lineTo(left, top + height);
    ctx.lineTo(left + width, top + height);
    ctx.closePath();
    ctx.clip();
  }
};

const fillBorderLeft = (ctx, layout, style, rbl, rtl) => {
  const { top, left, height } = layout;
  const {
    borderLeftColor,
    borderLeftStyle,
    borderLeftWidth,
    borderTopWidth,
    borderBottomWidth
  } = style;

  const c0 = rbl * (1.0 - KAPPA);
  const c1 = rtl * (1.0 - KAPPA);

  ctx.moveTo(left + rbl, top + height);
  ctx.bezierCurveTo(left + c0, top + height, left, top + height - c0, left, top + height - rbl);
  ctx.lineTo(left, top + rtl);
  ctx.bezierCurveTo(left, top + c1, left + c1, top, left + rtl, top);

  ctx.strokeColor(borderLeftColor);
  ctx.lineWidth(Math.max(borderLeftWidth, borderTopWidth, borderBottomWidth) * 2);

  if (borderLeftStyle === 'dashed') {
    ctx.dash(borderLeftWidth * 2, { space: borderLeftWidth * 1.2 });
  } else if (borderLeftStyle === 'dotted') {
    ctx.dash(borderLeftWidth, { space: borderLeftWidth * 1.2 });
  }

  ctx.stroke();
  ctx.undash();
};

var Borders = { drawBorders };

// This constant is used to approximate a symmetrical arc using a cubic
// Bezier curve.
const KAPPA$1 = 4.0 * ((Math.sqrt(2) - 1.0) / 3.0);

const Clipping = {
  clip() {
    const { top, left, width, height } = this.getAbsoluteLayout();

    const {
      borderTopLeftRadius = 0,
      borderTopRightRadius = 0,
      borderBottomRightRadius = 0,
      borderBottomLeftRadius = 0
    } = this.getComputedStyles();

    // Border top
    const rtr = Math.min(borderTopRightRadius, 0.5 * width, 0.5 * height);
    const ctr = rtr * (1.0 - KAPPA$1);

    this.root.instance.moveTo(left + rtr, top);
    this.root.instance.lineTo(left + width - rtr, top);
    this.root.instance.bezierCurveTo(left + width - ctr, top, left + width, top + ctr, left + width, top + rtr);

    // Border right
    const rbr = Math.min(borderBottomRightRadius, 0.5 * width, 0.5 * height);
    const cbr = rbr * (1.0 - KAPPA$1);

    this.root.instance.lineTo(left + width, top + height - rbr);
    this.root.instance.bezierCurveTo(left + width, top + height - cbr, left + width - cbr, top + height, left + width - rbr, top + height);

    // Border bottom
    const rbl = Math.min(borderBottomLeftRadius, 0.5 * width, 0.5 * height);
    const cbl = rbl * (1.0 - KAPPA$1);

    this.root.instance.lineTo(left + rbl, top + height);
    this.root.instance.bezierCurveTo(left + cbl, top + height, left, top + height - cbl, left, top + height - rbl);

    // Border left
    const rtl = Math.min(borderTopLeftRadius, 0.5 * width, 0.5 * height);
    const ctl = rtl * (1.0 - KAPPA$1);

    this.root.instance.lineTo(left, top + rtl);
    this.root.instance.bezierCurveTo(left, top + ctl, left + ctl, top, left + rtl, top);
    this.root.instance.closePath();
    this.root.instance.clip();
  }
};

const getRotation = transform => {
  const match = /rotate\((-?\d+.?\d+)(.+)\)/g.exec(transform);

  if (match && match[1] && match[2]) {
    const value = match[1];
    return match[2] === 'rad' ? value * 180 / Math.PI : value;
  }

  return 0;
};

const getTranslateX = transform => {
  const matchX = /translateX\((-?\d+\.?d*)\)/g.exec(transform);
  const matchGeneric = /translate\((-?\d+\.?d*).*,\s*(-?\d+\.?d*).*\)/g.exec(transform);

  if (matchX && matchX[1]) return matchX[1];
  if (matchGeneric && matchGeneric[1]) return matchGeneric[1];

  return 0;
};

const getTranslateY = transform => {
  const matchY = /translateY\((-?\d+\.?\d*)\)/g.exec(transform);
  const matchGeneric = /translate\((-?\d+\.?\d*).*,\s*(-?\d+\.?\d*).*\)/g.exec(transform);

  if (matchY && matchY[1]) return matchY[1];
  if (matchGeneric && matchGeneric[2]) return matchGeneric[2];

  return 0;
};

const getScaleX = transform => {
  const matchX = /scaleX\((-?\d+\.?\d*)\)/g.exec(transform);
  const matchGeneric = /scale\((-?\d+\.?\d*).*,\s*(-?\d+\.?\d*).*\)/g.exec(transform);

  if (matchX && matchX[1]) return matchX[1];
  if (matchGeneric && matchGeneric[1]) return matchGeneric[1];

  return 1;
};

const getScaleY = transform => {
  const matchY = /scaleY\((-?\d+\.?\d*)\)/g.exec(transform);
  const matchGeneric = /scale\((-?\d+\.?\d*).*,\s*(-?\d+\.?\d*).*\)/g.exec(transform);

  if (matchY && matchY[1]) return matchY[1];
  if (matchGeneric && matchGeneric[2]) return matchGeneric[2];

  return 1;
};

const getMatrix = transform => {
  const match = /matrix\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)\)/g.exec(transform);
  if (match) return match.slice(1, 7);
  return null;
};

const applySingleTransformation = (element, transform) => {
  const { left, top, width, height } = element.getAbsoluteLayout();
  const origin = [left + width / 2, top + height / 2];

  if (/rotate/g.test(transform)) {
    element.root.instance.rotate(getRotation(transform), { origin });
  } else if (/scaleX/g.test(transform)) {
    element.root.instance.scale(getScaleX(transform), 1, { origin });
  } else if (/scaleY/g.test(transform)) {
    element.root.instance.scale(1, getScaleY(transform), { origin });
  } else if (/scale/g.test(transform)) {
    element.root.instance.scale(getScaleX(transform), getScaleY(transform), {
      origin
    });
  } else if (/translateX/g.test(transform)) {
    element.root.instance.translate(getTranslateX(transform), 1, { origin });
  } else if (/translateY/g.test(transform)) {
    element.root.instance.translate(1, getTranslateY(transform), { origin });
  } else if (/translate/g.test(transform)) {
    element.root.instance.translate(getTranslateX(transform), getTranslateY(transform), { origin });
  } else if (/matrix/g.test(transform)) {
    element.root.instance.transform(...getMatrix(transform));
  }
};

const Transformations = {
  applyTransformations() {
    let match;
    const re = /[a-zA-Z]+\([^)]+\)/g;
    const transform = this.style && this.style.transform || '';

    while ((match = re.exec(transform)) != null) {
      applySingleTransformation(this, match[0]);
    }
  }
};

const inheritedProperties = ['color', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'letterSpacing', 'textDecoration', 'lineHeight', 'textAlign', 'visibility', 'wordSpacing'];

class Base extends Node$1 {
  constructor(root, props) {
    super();

    this.root = root;
    this.props = merge({}, this.constructor.defaultProps, Base.defaultProps, props);

    warning(!this.props.styles, '"styles" prop passed instead of "style" prop');
  }

  get page() {
    return this.parent.page;
  }

  get wrap() {
    return this.props.wrap;
  }

  get break() {
    return this.props.break;
  }

  get fixed() {
    return this.props.fixed;
  }

  get minPresenceAhead() {
    return this.props.minPresenceAhead;
  }

  get absolute() {
    return this.props.style.position === 'absolute';
  }

  set break(value) {
    this.props.break = value;
  }

  appendChild(child) {
    super.appendChild(child);
    this.root.markDirty();
  }

  appendChildBefore(child, beforeChild) {
    super.appendChildBefore(child, beforeChild);
    this.root.markDirty();
  }

  removeChild(child) {
    super.removeChild(child);
    this.root.markDirty();
  }

  update(newProps) {
    this.props = merge({}, this.constructor.defaultProps, Base.defaultProps, newProps);
    this.root.markDirty();
  }

  applyProps() {
    const { size, orientation } = this.page;

    this.style = StyleSheet.resolve(this.props.style, {
      width: size.width,
      height: size.height,
      orientation: orientation
    });

    toPairsIn(this.style).map(([attribute, value]) => {
      this.applyStyle(attribute, value);
    });

    this.children.forEach(child => {
      if (child.applyProps) {
        child.applyProps();
      }
    });
  }

  applyStyle(attribute, value) {
    const setter = `set${upperFirst(attribute)}`;

    switch (attribute) {
      case 'marginTop':
      case 'marginRight':
      case 'marginBottom':
      case 'marginLeft':
      case 'paddingTop':
      case 'paddingRight':
      case 'paddingBottom':
      case 'paddingLeft':
      case 'borderTopWidth':
      case 'borderRightWidth':
      case 'borderBottomWidth':
      case 'borderLeftWidth':
      case 'position':
      case 'top':
      case 'right':
      case 'bottom':
      case 'left':
      case 'width':
      case 'height':
      case 'minHeight':
      case 'maxHeight':
      case 'minWidth':
      case 'maxWidth':
        this[attribute] = value;
        break;
      default:
        if (isFunction(this.layout[setter])) {
          this.layout[setter](value);
        }
    }
  }

  getComputedStyles() {
    let element = this.parent;
    let inheritedStyles = {};

    while (element && element.parent) {
      inheritedStyles = _extends({}, element.parent.style, element.style, inheritedStyles);
      element = element.parent;
    }

    return _extends({}, pick(inheritedStyles, inheritedProperties), this.style);
  }

  getLayoutData() {
    const layout = this.getAbsoluteLayout();

    return {
      type: this.name,
      top: layout.top,
      left: layout.left,
      width: layout.width,
      height: layout.height,
      style: this.getComputedStyles(),
      children: this.children.map(c => {
        return c.getLayoutData();
      })
    };
  }

  drawBackgroundColor() {
    const { left, top, width, height } = this.getAbsoluteLayout();
    const styles = this.getComputedStyles();

    if (styles.backgroundColor) {
      this.root.instance.save();

      this.clip();

      this.root.instance.fillColor(styles.backgroundColor).rect(left, top, width, height).fill().restore();
    }
  }

  clone() {
    const clone = new this.constructor(this.root, this.props);

    clone.copyStyle(this);
    clone.style = this.style;

    return clone;
  }

  onNodeSplit(height, clone) {
    this.calculateLayout();

    clone.marginTop = 0;
    clone.paddingTop = 0;

    // If a height was given to the element, we need to substract the remaining wrapping height
    // If not, we just let Yoga calculate the appropiate height when layout get's calculated.
    if (clone.style.height) {
      clone.height = this.height - height;
    }

    this.height = height;
    this.marginBottom = 0;
    this.paddingBottom = 0;
  }

  async renderChildren() {
    const absoluteChilds = this.children.filter(child => child.absolute);
    const nonAbsoluteChilds = this.children.filter(child => !child.absolute);

    for (let i = 0; i < nonAbsoluteChilds.length; i++) {
      await nonAbsoluteChilds[i].render();
    }

    for (let i = 0; i < absoluteChilds.length; i++) {
      await absoluteChilds[i].render();
    }
  }
}

Base.defaultProps = {
  style: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomLeftRadius: 0
  },
  minPresenceAhead: 0
};

_Object$assign(Base.prototype, Debug);
_Object$assign(Base.prototype, Borders);
_Object$assign(Base.prototype, Clipping);
_Object$assign(Base.prototype, Transformations);

class TextInstance {
  constructor(root, value) {
    this.root = root;
    this.value = value;
    this.parent = null;
    this.props = {};
  }

  get name() {
    return 'TextInstance';
  }

  getLayoutData() {
    return this.value;
  }

  remove() {
    this.parent.removeChild(this);
  }

  clone() {
    return new this.constructor(this.root, this.value);
  }

  update(value) {
    this.value = value;
    this.parent.computed = false;
    this.parent._container = null;
    this.root.markDirty();
  }
}

const PAGE_SIZES = {
  '4A0': [4767.87, 6740.79],
  '2A0': [3370.39, 4767.87],
  A0: [2383.94, 3370.39],
  A1: [1683.78, 2383.94],
  A2: [1190.55, 1683.78],
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  A6: [297.64, 419.53],
  A7: [209.76, 297.64],
  A8: [147.4, 209.76],
  A9: [104.88, 147.4],
  A10: [73.7, 104.88],
  B0: [2834.65, 4008.19],
  B1: [2004.09, 2834.65],
  B2: [1417.32, 2004.09],
  B3: [1000.63, 1417.32],
  B4: [708.66, 1000.63],
  B5: [498.9, 708.66],
  B6: [354.33, 498.9],
  B7: [249.45, 354.33],
  B8: [175.75, 249.45],
  B9: [124.72, 175.75],
  B10: [87.87, 124.72],
  C0: [2599.37, 3676.54],
  C1: [1836.85, 2599.37],
  C2: [1298.27, 1836.85],
  C3: [918.43, 1298.27],
  C4: [649.13, 918.43],
  C5: [459.21, 649.13],
  C6: [323.15, 459.21],
  C7: [229.61, 323.15],
  C8: [161.57, 229.61],
  C9: [113.39, 161.57],
  C10: [79.37, 113.39],
  RA0: [2437.8, 3458.27],
  RA1: [1729.13, 2437.8],
  RA2: [1218.9, 1729.13],
  RA3: [864.57, 1218.9],
  RA4: [609.45, 864.57],
  SRA0: [2551.18, 3628.35],
  SRA1: [1814.17, 2551.18],
  SRA2: [1275.59, 1814.17],
  SRA3: [907.09, 1275.59],
  SRA4: [637.8, 907.09],
  EXECUTIVE: [521.86, 756.0],
  FOLIO: [612.0, 936.0],
  LEGAL: [612.0, 1008.0],
  LETTER: [612.0, 792.0],
  TABLOID: [792.0, 1224.0]
};

// Return page size in an object { width, height } given the passed size and orientation
// Accepts page type, arraoy or object as parameter
const getPageSize = (size, orientation = 'portrait') => {
  let result;

  if (typeof size === 'string') {
    result = PAGE_SIZES[size.toUpperCase()];
  } else if (Array.isArray(size)) {
    result = size;
  } else if (typeof size === 'object' && size.width && size.height) {
    result = [size.width, size.height];
  } else {
    throw new Error(`Invalid Page size: ${size}`);
  }

  return orientation === 'portrait' ? { width: result[0], height: result[1] } : { width: result[1], height: result[0] };
};

const RULER_WIDTH = 13;
const RULER_COLOR = 'white';
const RULER_FONT_SIZE = 5;
const DEFAULT_RULER_STEPS = 50;
const LINE_WIDTH = 0.5;
const LINE_COLOR = 'gray';
const GRID_COLOR = '#ababab';

const range = (max, steps) => _Array$from({ length: Math.ceil(max / steps) }, (_, i) => i * steps);

const matchPercentage = value => {
  const match = value.match(/(\d+\.?\d*)%/);
  if (match) {
    return 100 / parseFloat(match[1], 10);
  }

  return null;
};

const Ruler = {
  getRulerWidth() {
    return RULER_WIDTH;
  },
  hasHorizontalRuler() {
    return this.props.ruler || this.props.horizontalRuler;
  },
  hasVerticalRuler() {
    return this.props.ruler || this.props.verticalRuler;
  },
  getHorizontalSteps() {
    const value = this.props.horizontalRulerSteps || this.props.rulerSteps || DEFAULT_RULER_STEPS;

    if (typeof value === 'string') {
      const percentage = matchPercentage(value);
      if (percentage) {
        const width = this.width - (this.hasVerticalRuler() ? RULER_WIDTH : 0);
        return width / percentage;
      }
      throw new Error('Page: Invalid horizontal steps value');
    }

    return value;
  },
  getVerticalSteps() {
    const value = this.props.verticalRulerSteps || this.props.rulerSteps || DEFAULT_RULER_STEPS;

    if (typeof value === 'string') {
      const percentage = matchPercentage(value);
      if (percentage) {
        const height = this.height - (this.hasHorizontalRuler() ? RULER_WIDTH : 0);
        return height / percentage;
      }
      throw new Error('Page: Invalid horizontal steps value');
    }

    return value;
  },
  renderRuler() {
    const hasHorizontalRuler = this.hasHorizontalRuler();
    const hasVerticalRuler = this.hasVerticalRuler();

    if (hasHorizontalRuler || hasVerticalRuler) {
      this.root.instance.save().lineWidth(LINE_WIDTH).fontSize(RULER_FONT_SIZE).opacity(1);

      if (hasHorizontalRuler) this.drawHorizontalRuler();

      if (hasVerticalRuler) this.drawVerticalRuler();

      if (hasHorizontalRuler && hasVerticalRuler) {
        this.root.instance.rect(0, 0, RULER_WIDTH - LINE_WIDTH, RULER_WIDTH - LINE_WIDTH).fill(RULER_COLOR);
      }

      this.root.instance.restore();
    }
  },
  drawHorizontalRuler() {
    const offset = this.hasVerticalRuler() ? RULER_WIDTH : 0;

    this.root.instance.rect(offset, 0, this.width, RULER_WIDTH).fill(RULER_COLOR).moveTo(this.hasVerticalRuler() ? RULER_WIDTH : 0, RULER_WIDTH).lineTo(this.width, RULER_WIDTH).stroke(LINE_COLOR);

    const hRange = range(this.width, this.getHorizontalSteps());

    hRange.map(step => {
      this.root.instance.moveTo(offset + step, 0).lineTo(offset + step, RULER_WIDTH).stroke(LINE_COLOR).fillColor('black').text(`${Math.round(step)}`, offset + step + 1, 1);
    });

    hRange.map(step => {
      if (step !== 0) {
        this.root.instance.moveTo(offset + step, RULER_WIDTH).lineTo(offset + step, this.height).stroke(GRID_COLOR);
      }
    });
  },
  drawVerticalRuler() {
    const offset = this.hasHorizontalRuler() ? RULER_WIDTH : 0;

    this.root.instance.rect(0, offset, RULER_WIDTH, this.height).fill(RULER_COLOR).moveTo(RULER_WIDTH, this.hasHorizontalRuler() ? RULER_WIDTH : 0).lineTo(RULER_WIDTH, this.height).stroke(LINE_COLOR);

    const vRange = range(this.height, this.getVerticalSteps());

    vRange.map(step => {
      this.root.instance.moveTo(0, offset + step).lineTo(RULER_WIDTH, offset + step).stroke(LINE_COLOR).fillColor('black').text(`${Math.round(step)}`, 1, offset + step + 1);
    });

    vRange.map(step => {
      if (step !== 0) {
        this.root.instance.moveTo(RULER_WIDTH, offset + step).lineTo(this.width, offset + step).stroke(GRID_COLOR);
      }
    });
  }
};

class Page$1 extends Base {

  constructor(root, props) {
    super(root, props);

    this._size = null;
  }

  get name() {
    return 'Page';
  }

  get document() {
    return this.parent;
  }

  get page() {
    return this;
  }

  get orientation() {
    return this.props.orientation;
  }

  get size() {
    if (this._size) return this._size;

    this._size = getPageSize(this.props.size, this.orientation);

    // Adjust size for ruler
    if (this.hasHorizontalRuler()) {
      this._size.width += this.getRulerWidth();
    }

    if (this.hasVerticalRuler()) {
      this._size.height += this.getRulerWidth();
    }

    return this._size;
  }

  resetMargins() {
    if (!!this.marginTop || !!this.marginBottom || !!this.marginLeft || !!this.marginRight) {
      warning(false, 'Margin values are not allowed on Page element. Use padding instead.');

      this.marginTop = 0;
      this.marginBottom = 0;
      this.marginLeft = 0;
      this.marginRight = 0;
    }
  }

  applyProps() {
    super.applyProps();

    this.top = 0;
    this.left = 0;
    this.width = this.size.width;

    this.resetMargins();

    // Add some padding if ruler present, so we can see the whole page inside it
    const rulerWidth = this.getRulerWidth();

    if (this.hasHorizontalRuler()) {
      this.paddingTop = this.paddingTop + rulerWidth;
    }

    if (this.hasVerticalRuler()) {
      this.paddingLeft = this.paddingLeft + rulerWidth;
    }
  }

  setPadding(edge, value) {
    const isPercent = matchPercent(value);
    const dimension = edge === Yoga.EDGE_TOP || edge === Yoga.EDGE_BOTTOM ? this.size.height : this.size.width;

    if (isPercent) {
      const percent = parseFloat(isPercent[1], 10) / 100;
      this.layout.setPadding(edge, dimension * percent);
    } else {
      this.layout.setPadding(edge, value);
    }
  }

  async addDynamicChild(parent, elements) {
    if (!elements) return;
    const children = Array.isArray(elements) ? elements : [elements];

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const { type, props } = child;

      if (typeof child === 'string') {
        const instance = new TextInstance(this.root, child);
        parent.appendChild(instance);
      } else if (type !== Fragment) {
        const instance = createInstance(child, this.root);
        await instance.onAppendDynamically();
        parent.appendChild(instance);
        instance.applyProps();
        await this.addDynamicChild(instance, props.children);
      } else {
        await this.addDynamicChild(parent, props.children);
      }
    }
  }

  async renderDynamicNodes(props, cb) {
    const listToExplore = this.children.slice(0);

    while (listToExplore.length > 0) {
      const node = listToExplore.shift();
      const condition = cb ? cb(node) : true;

      if (condition && node.props.render) {
        node.removeAllChilds();
        const elements = node.props.render(props);
        await this.addDynamicChild(node, elements);
        if (!node.fixed) node.props.render = null;
        continue;
      }

      if (node.children) {
        listToExplore.push(...node.children);
      }
    }
  }

  async nodeWillWrap(props) {
    await this.renderDynamicNodes(props);
    this.calculateLayout();
  }

  onNodeSplit(height, clone) {
    clone.marginTop = 0;
    this.marginBottom = 0;
    this.calculateLayout();
  }

  clone() {
    const clone = super.clone();
    clone._size = this.size;
    return clone;
  }

  async render() {
    const { instance } = this.root;

    this.height = this.size.height;
    this.calculateLayout();

    instance.addPage({
      size: [this.size.width, this.size.height],
      margin: 0
    });

    if (this.style.backgroundColor) {
      instance.fillColor(this.style.backgroundColor).rect(0, 0, this.size.width, this.size.height).fill();
    }

    await this.renderChildren();

    if (this.props.debug) this.debug();

    this.renderRuler();
  }
}

Page$1.defaultProps = {
  size: 'A4',
  orientation: 'portrait',
  style: {},
  wrap: true
};
_Object$assign(Page$1.prototype, Ruler);

class View$1 extends Base {

  get name() {
    return 'View';
  }

  async render() {
    this.root.instance.save();
    this.applyTransformations();
    this.drawBackgroundColor();
    this.drawBorders();
    await this.renderChildren();
    if (this.props.debug) this.debug();
    this.root.instance.restore();
  }
}

View$1.defaultProps = {
  style: {},
  wrap: true
};

const PROTOCOL_REGEXP = /^(http|https|ftp|ftps|mailto)\:\/\//i;



const getURL = value => {
  if (typeof value === 'string' && !value.match(PROTOCOL_REGEXP)) {
    return `http://${value}`;
  }

  return value;
};

const capitalize = value => value.replace(/(^|\s)\S/g, l => l.toUpperCase());

const IGNORABLE_CODEPOINTS = [8232, // LINE_SEPARATOR
8233];

const buildSubsetForFont = font => IGNORABLE_CODEPOINTS.reduce((acc, codePoint) => {
  if (font.hasGlyphForCodePoint && font.hasGlyphForCodePoint(codePoint)) {
    return acc;
  }
  return [...acc, String.fromCharCode(codePoint)];
}, []);

const ignoreChars = fragments => fragments.map(fragment => {
  const charSubset = buildSubsetForFont(fragment.attributes.font);
  const subsetRegex = new RegExp(charSubset.join('|'));

  return {
    string: fragment.string.replace(subsetRegex, ''),
    attributes: fragment.attributes
  };
});

const PREPROCESSORS = [ignoreChars, embedEmojis];

const transformText = (text, transformation) => {
  switch (transformation) {
    case 'uppercase':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    case 'capitalize':
      return capitalize(text);
    default:
      return text;
  }
};

const getFragments = instance => {
  if (!instance) return [{ string: '' }];

  let fragments = [];
  const {
    color = 'black',
    backgroundColor,
    fontFamily = 'Helvetica',
    fontSize = 18,
    textAlign = 'left',
    position,
    top,
    bottom,
    lineHeight,
    textDecoration,
    textDecorationColor,
    textDecorationStyle,
    textTransform,
    letterSpacing
  } = instance.getComputedStyles();

  instance.children.forEach(child => {
    if (child.value !== null && child.value !== undefined) {
      const obj = Font.getFont(fontFamily);
      const font = obj ? obj.data : fontFamily;
      const string = transformText(child.value, textTransform);

      fragments.push({
        string,
        attributes: {
          font,
          color,
          fontSize,
          backgroundColor,
          align: textAlign,
          link: instance.src,
          characterSpacing: letterSpacing,
          underlineStyle: textDecorationStyle,
          underline: textDecoration === 'underline',
          underlineColor: textDecorationColor || color,
          lineHeight: lineHeight ? lineHeight * fontSize : null,
          yOffset: position === 'relative' ? -top || bottom || 0 : null
        }
      });
    } else {
      if (child) {
        fragments.push(...getFragments(child));
      }
    }
  });

  for (const preprocessor of PREPROCESSORS) {
    fragments = preprocessor(fragments);
  }

  return fragments;
};

const getAttributedString = instance => {
  return AttributedString.fromFragments(getFragments(instance)).trim();
};

const PDFRenderer$2 = createPDFRenderer({ Rect });

class Text$1 extends Base {

  constructor(root, props) {
    super(root, props);

    this.start = 0;
    this.end = 0;
    this.computed = false;
    this._container = null;
    this._attributedString = null;
    this._layoutEngine = null;
    this.renderCallback = props.render;
    this.layout.setMeasureFunc(this.measureText.bind(this));
  }

  get name() {
    return 'Text';
  }

  get src() {
    return getURL(this.props.src || this.props.href);
  }

  get attributedString() {
    if (!this._attributedString) {
      this._attributedString = getAttributedString(this);
    }
    return this._attributedString;
  }

  set attributedString(value) {
    this._attributedString = value;
  }

  get container() {
    const lines = this._container.blocks.reduce((acc, block) => [...acc, ...block.lines], []);

    return _extends({}, this._container, {
      blocks: [{ lines: lines.splice(this.start, this.end) }]
    });
  }

  get lines() {
    if (!this.container) return [];

    return this.container.blocks.reduce((acc, block) => [...acc, ...block.lines], []);
  }

  get linesHeight() {
    if (!this._container) return -1;
    return this.lines.reduce((acc, line) => acc + line.height, 0);
  }

  get linesWidth() {
    if (!this._container) return -1;
    return Math.max(...this.lines.map(line => line.advanceWidth));
  }

  get layoutEngine() {
    if (!this._layoutEngine) {
      const { hyphenationPenalty } = this.props;
      const hyphenationCallback = Font.getHyphenationCallback();
      this._layoutEngine = new LayoutEngine$1({
        hyphenationCallback,
        hyphenationPenalty
      });
    }

    return this._layoutEngine;
  }

  set layoutEngine(instance) {
    this._layoutEngine = instance;
  }

  appendChild(child) {
    if (child) {
      child.parent = this;
      this.children.push(child);
      this.computed = false;
      this._attributedString = null;
      this.markDirty();
    }
  }

  removeChild(child) {
    const index = this.children.indexOf(child);

    if (index !== -1) {
      child.parent = null;
      this.children.splice(index, 1);
      this.computed = false;
      this._attributedString = null;
      this.markDirty();
    }
  }

  lineIndexAtHeight(height) {
    let counter = 0;
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];

      if (counter + line.height > height) {
        return i;
      }

      counter += line.height;
    }

    return this.lines.length;
  }

  heightAtLineIndex(index) {
    let counter = 0;

    for (let i = 0; i < index; i++) {
      const line = this.lines[i];
      counter += line.height;
    }

    return counter;
  }

  layoutText(width, height) {
    // IF height null or NaN, we take some liberty on layout height
    const containerHeight = height || this.page.size.height;

    // Text layout is expensive. That's why we ensure to only do it once
    // (except dynamic nodes. Those change content and needs to relayout every time)
    if (!this._container || this.props.render) {
      const path$$1 = new Path().rect(0, 0, width, containerHeight);
      const container = new Container(path$$1);
      const attributedString = this.attributedString;

      // Do the actual text layout
      this.layoutEngine.layout(attributedString, [container]);
      this._container = container;
    }

    // Get the total amount of rendered lines
    const linesCount = this._container.blocks.reduce((acc, block) => acc + block.lines.length, 0);

    this.computed = true;
    this.end = linesCount + 1;
  }

  measureText(width, widthMode, height, heightMode) {
    if (widthMode === Yoga.MEASURE_MODE_EXACTLY) {
      this.layoutText(width);

      return { height: this.style.flexGrow ? NaN : this.linesHeight };
    }

    if (widthMode === Yoga.MEASURE_MODE_AT_MOST || heightMode === Yoga.MEASURE_MODE_AT_MOST) {
      this.layoutText(width, height);

      return {
        height: this.linesHeight,
        width: Math.min(width, this.linesWidth)
      };
    }

    return {};
  }

  getComputedStyles() {
    const styles = super.getComputedStyles();

    // Inherit relative positioning for inline childs
    if (this.parent && this.parent.name === 'Text' && this.parent.style.position === 'relative') {
      styles.top = styles.top || this.parent.style.top;
      styles.bottom = styles.bottom || this.parent.style.bottom;
      styles.position = styles.position || 'relative';
    }

    // Apply default link styles
    if (this.src) {
      styles.color = styles.color || 'blue';
      styles.textDecoration = styles.textDecoration || 'underline';
    }

    return styles;
  }

  wrapHeight(height) {
    const { orphans, widows } = this.props;
    const linesQuantity = this.lines.length;
    const sliceHeight = height - this.paddingTop;
    const slicedLine = this.lineIndexAtHeight(sliceHeight);

    if (linesQuantity < orphans) {
      return height;
    } else if (slicedLine < orphans || linesQuantity < orphans + widows) {
      return 0;
    } else if (linesQuantity === orphans + widows) {
      return this.heightAtLineIndex(orphans);
    } else if (linesQuantity - slicedLine < widows) {
      return height - this.heightAtLineIndex(widows - 1);
    }

    return height;
  }

  onNodeSplit(height, clone) {
    const wrapHeight = this.wrapHeight(height);
    const slicedLineIndex = this.lineIndexAtHeight(wrapHeight);

    clone.marginTop = 0;
    clone.paddingTop = 0;
    clone.start = slicedLineIndex;
    clone.attributedString = this.attributedString;

    this.height = wrapHeight;
    this.marginBottom = 0;
    this.paddingBottom = 0;
    this.end = slicedLineIndex;
  }

  clone() {
    const text = super.clone();

    text.layoutEngine = this.layoutEngine;

    // Save calculated layout for non-dynamic clone elements
    if (!this.props.render && !this.props.fixed) {
      text._container = this._container;
    }

    return text;
  }

  async render() {
    this.root.instance.save();
    this.applyTransformations();
    this.drawBackgroundColor();
    this.drawBorders();

    // Calculate text layout if needed
    // This can happen if measureText was not called by Yoga
    if (!this.computed) {
      this.layoutText(this.width - this.padding.left - this.padding.right, this.height - this.padding.top - this.padding.bottom);
    }

    const padding = this.padding;
    const { top, left } = this.getAbsoluteLayout();

    // We translate lines based on Yoga container
    const initialX = this.lines[0] ? this.lines[0].rect.y : 0;

    this.lines.forEach(line => {
      line.rect.x = left + padding.left;
      line.rect.y += top + padding.top - initialX;
    });

    const renderer = new PDFRenderer$2(this.root.instance, {
      outlineLines: false
    });

    renderer.render(this.container);

    if (this.props.debug) {
      this.debug();
    }

    this.root.instance.restore();
  }
}

Text$1.defaultProps = {
  wrap: true,
  widows: 2,
  orphans: 2
};

class Link$1 extends Base {
  get name() {
    return 'Link';
  }

  get src() {
    return getURL(this.props.src || this.props.href);
  }

  async render() {
    const { top, left, width, height } = this.getAbsoluteLayout();
    this.root.instance.link(left, top, width, height, this.src);
    await this.renderChildren();
    if (this.props.debug) this.debug();
  }
}

class Note$1 extends Base {

  get name() {
    return 'Note';
  }

  appendChild(child) {
    if (child.name !== 'TextInstance') {
      throw new Error('Note only accepts string children');
    }

    if (child) {
      child.parent = this;
      this.children.push(child);
    }
  }

  removeChild(child) {
    const index = this.children.indexOf(child);

    if (index !== -1) {
      child.parent = null;
      this.children.splice(index, 1);
    }
  }

  applyProps() {
    super.applyProps();
    this.height = 0;
    this.width = 0;
  }

  async render() {
    const { top, left } = this.getAbsoluteLayout();
    const value = this.children[0] ? this.children[0].value : '';

    this.root.instance.note(left, top, 0, 0, value);
  }
}

Note$1.defaultProps = {};

const SAFETY_HEIGHT = 10;

// We manage two bounding boxes in this class:
//  - Yoga node: Image bounding box. Adjust based on image and page size
//  - Image node: Real image container. In most cases equals Yoga node, except if image is bigger than page
class Image$1 extends Base {

  constructor(root, props) {
    super(root, props);

    this.image = null;
    this.layout.setMeasureFunc(this.measureImage.bind(this));
  }

  get name() {
    return 'Image';
  }

  shouldGrow() {
    return !!this.getComputedStyles().flexGrow;
  }

  measureImage(width, widthMode, height, heightMode) {
    const imageMargin = this.margin;
    const pagePadding = this.page.padding;
    const pageArea = this.page.size.height - pagePadding.top - pagePadding.bottom - imageMargin.top - imageMargin.bottom - SAFETY_HEIGHT;

    // Skip measure if image data not present yet
    if (!this.image) return { width: 0, height: 0 };

    if (widthMode === Yoga.MEASURE_MODE_EXACTLY && heightMode === Yoga.MEASURE_MODE_UNDEFINED) {
      const scaledHeight = width / this.ratio;
      return { height: Math.min(pageArea, scaledHeight) };
    }

    if (heightMode === Yoga.MEASURE_MODE_EXACTLY && (widthMode === Yoga.MEASURE_MODE_AT_MOST || widthMode === Yoga.MEASURE_MODE_UNDEFINED)) {
      return { width: Math.min(height * this.ratio, width) };
    }

    if (widthMode === Yoga.MEASURE_MODE_EXACTLY && heightMode === Yoga.MEASURE_MODE_AT_MOST) {
      const scaledHeight = width / this.ratio;
      return { height: Math.min(height, pageArea, scaledHeight) };
    }

    if (widthMode === Yoga.MEASURE_MODE_AT_MOST && heightMode === Yoga.MEASURE_MODE_AT_MOST) {
      if (this.ratio > 1) {
        return {
          width: width,
          height: Math.min(width / this.ratio, height)
        };
      } else {
        return {
          width: Math.min(height * this.ratio, width),
          height: height
        };
      }
    }

    return { height, width };
  }

  get ratio() {
    return this.image.data ? this.image.width / this.image.height : 1;
  }

  async fetch() {
    const { src, cache, safePath, allowDangerousPaths } = this.props;
    try {
      this.image = await resolveImage(src, {
        cache,
        safePath,
        allowDangerousPaths
      });
    } catch (e) {
      this.image = { width: 0, height: 0 };
      console.warn(e.message);
    }
  }

  clone() {
    const clone = super.clone();
    clone.image = this.image;
    return clone;
  }

  async onAppendDynamically() {
    await this.fetch();
  }

  renderImage() {
    const padding = this.padding;
    const { left, top } = this.getAbsoluteLayout();

    this.root.instance.save();

    // Clip path to keep image inside border radius
    this.clip();

    if (this.image.data) {
      // Inner offset between yoga node and image box
      // Makes image centered inside Yoga node
      const width = Math.min(this.height * this.ratio, this.width) - padding.left - padding.right;
      const height = this.height - padding.top - padding.bottom;
      const xOffset = Math.max((this.width - width) / 2, 0);

      if (width !== 0 && height !== 0) {
        this.root.instance.image(this.image.data, left + padding.left + xOffset, top + padding.top, { width, height });
      } else {
        warning(false, `Image with src '${this.props.src}' skipped due to invalid dimensions`);
      }
    }

    this.root.instance.restore();
  }

  async render() {
    this.root.instance.save();
    this.applyTransformations();
    this.drawBackgroundColor();
    this.renderImage();
    this.drawBorders();

    if (this.props.debug) {
      this.debug();
    }

    this.root.instance.restore();
  }
}

Image$1.defaultProps = {
  wrap: false,
  cache: true
};

const constructors = {
  ROOT: Root,
  PAGE: Page$1,
  TEXT: Text$1,
  LINK: Link$1,
  VIEW: View$1,
  NOTE: Note$1,
  IMAGE: Image$1,
  DOCUMENT: Document$1,
  TEXT_INSTANCE: TextInstance
};

function createInstance(element, root) {
  const { type, props = {} } = element;

  if (constructors[type]) {
    return new constructors[type](root, props);
  }

  throw new Error(`Invalid element of type ${type} passed to PDF renderer`);
}

const propsEqual = (a, b) => {
  const oldPropsKeys = _Object$keys(a);
  const newPropsKeys = _Object$keys(b);

  if (oldPropsKeys.length !== newPropsKeys.length) {
    return false;
  }

  for (let i = 0; i < oldPropsKeys.length; i++) {
    const propName = oldPropsKeys[i];

    if (propName === 'render') {
      if (!a[propName] !== !b[propName]) {
        return false;
      }
      continue;
    }

    if (propName !== 'children' && a[propName] !== b[propName]) {
      if (typeof a[propName] === 'object' && typeof b[propName] === 'object' && propsEqual(a[propName], b[propName])) {
        continue;
      }

      return false;
    }

    if (propName === 'children' && (typeof a[propName] === 'string' || typeof b[propName] === 'string')) {
      return a[propName] === b[propName];
    }
  }

  return true;
};

// If the Link has a strign child or render prop, substitute the instance by a Text,
// that will ultimately render the inline Link via the textkit PDF renderer.
const shouldReplaceLink = (type, props) => type === 'LINK' && (typeof props.children === 'string' || Array.isArray(props.children) || props.render);

const PDFRenderer = ReactFiberReconciler({
  supportsMutation: true,
  appendInitialChild(parentInstance, child) {
    parentInstance.appendChild(child);
  },

  createInstance(type, props, internalInstanceHandle) {
    const instanceType = shouldReplaceLink(type, props) ? 'TEXT' : type;
    return createInstance({ type: instanceType, props }, internalInstanceHandle);
  },

  createTextInstance(text, rootContainerInstance) {
    return createInstance({ type: 'TEXT_INSTANCE', props: text }, rootContainerInstance);
  },

  finalizeInitialChildren(element, type, props) {
    return false;
  },

  getPublicInstance(instance) {
    return instance;
  },

  prepareForCommit() {
    // Noop
  },

  prepareUpdate(element, type, oldProps, newProps) {
    return !propsEqual(oldProps, newProps);
  },

  resetAfterCommit() {
    // Noop
  },

  resetTextContent(element) {
    // Noop
  },

  getRootHostContext() {
    return emptyObject;
  },

  getChildHostContext() {
    return emptyObject;
  },

  shouldSetTextContent(type, props) {
    return false;
  },

  now: Date.now,

  useSyncScheduling: true,

  appendChild(parentInstance, child) {
    parentInstance.appendChild(child);
  },

  appendChildToContainer(parentInstance, child) {
    parentInstance.appendChild(child);
  },

  insertBefore(parentInstance, child, beforeChild) {
    parentInstance.appendChildBefore(child, beforeChild);
  },

  removeChild(parentInstance, child) {
    parentInstance.removeChild(child);
  },

  removeChildFromContainer(parentInstance, child) {
    parentInstance.removeChild(child);
  },

  commitTextUpdate(textInstance, oldText, newText) {
    textInstance.update(newText);
  },

  commitUpdate(instance, updatePayload, type, oldProps, newProps) {
    instance.update(newProps);
  }
});

var version = "1.2.3";

const View = 'VIEW';
const Text = 'TEXT';
const Link = 'LINK';
const Page = 'PAGE';
const Note = 'NOTE';
const Image = 'IMAGE';
const Document = 'DOCUMENT';

const pdf = input => {
  const container = createInstance({ type: 'ROOT' });
  const mountNode = PDFRenderer.createContainer(container);

  if (input) updateContainer(input);

  function callOnRender(params = {}) {
    if (container.document.props.onRender) {
      const layoutData = container.document.getLayoutData();
      container.document.props.onRender(_extends({}, params, { layoutData }));
    }
  }

  function isDirty() {
    return container.isDirty;
  }

  function updateContainer(doc) {
    PDFRenderer.updateContainer(doc, mountNode, null);
  }

  async function toBlob() {
    await container.render();

    const stream = container.instance.pipe(BlobStream());

    return new _Promise((resolve, reject) => {
      stream.on('finish', () => {
        try {
          const blob = stream.toBlob('application/pdf');

          callOnRender({ blob });

          resolve(blob);
        } catch (error) {
          reject(error);
        }
      });

      stream.on('error', reject);
    });
  }

  function toBuffer() {
    callOnRender();

    container.render();

    return container.instance;
  }

  function toString() {
    let result = '';
    container.render();

    return new _Promise((resolve, reject) => {
      try {
        container.instance.on('data', function (buffer) {
          result += buffer;
        });

        container.instance.on('end', function () {
          callOnRender({ string: result });
          resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  return {
    isDirty,
    updateContainer,
    toBuffer,
    toBlob,
    toString
  };
};

const renderToStream = function (element) {
  return pdf(element).toBuffer();
};

const renderToFile = function (element, filePath, callback) {
  const output = renderToStream(element);
  const stream = fs.createWriteStream(filePath);

  output.pipe(stream);

  return new _Promise((resolve, reject) => {
    stream.on('finish', () => {
      if (callback) callback(output, filePath);
      resolve(output);
    });
    stream.on('error', reject);
  });
};

const throwEnvironmentError = name => {
  throw new Error(`${name} is a web specific API. Or you're either using this component on Node, or your bundler is not loading react-pdf from the appropiate web build.`);
};

const PDFViewer = () => {
  throwEnvironmentError('PDFViewer');
};

const PDFDownloadLink = () => {
  throwEnvironmentError('PDFDownloadLink');
};

const BlobProvider = () => {
  throwEnvironmentError('BlobProvider');
};

const render = renderToFile;

var node = {
  pdf,
  View,
  Text,
  Link,
  Page,
  Font,
  Note,
  Image,
  version,
  Document,
  StyleSheet,
  PDFRenderer,
  PDFViewer,
  BlobProvider,
  PDFDownloadLink,
  createInstance,
  renderToStream,
  renderToFile,
  render
};

export { renderToStream, renderToFile, PDFViewer, PDFDownloadLink, BlobProvider, render, pdf, View, Text, Link, Page, Font, Note, Image, version, Document, StyleSheet, PDFRenderer, createInstance };
export default node;
//# sourceMappingURL=react-pdf.es.js.map