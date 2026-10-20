import { MecabWorker } from "mecab-web-worker";

let worker = null;

function dictionaryUrl() {
  return new URL(
    "./dictionaries/unidic-mecab-2.1.2_bin.zip",
    document.baseURI
  ).href;
}

export async function initializeMecab(onProgress = () => {}) {
  if (worker) return worker;
  onProgress("MeCab/WASMとUniDicを読み込んでいます…");
  worker = await MecabWorker.create(dictionaryUrl());
  onProgress("MeCab/UniDic準備完了");
  return worker;
}

function firstValue(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== "" && value !== "*") {
      return value;
    }
  }
  return "";
}

function normalizeFeature(node) {
  const feature = node.feature ?? node.features ?? [];
  let fields = [];

  if (Array.isArray(feature)) fields = feature;
  else if (typeof feature === "string") fields = feature.split(",");
  else if (feature && Array.isArray(feature.values)) fields = feature.values;

  const objectFeature =
    feature && typeof feature === "object" && !Array.isArray(feature)
      ? feature
      : {};

  return {
    pos: String(firstValue(objectFeature, ["pos1", "pos", "partOfSpeech"]) || fields[0] || "未知語"),
    pos2: String(firstValue(objectFeature, ["pos2", "subpos1", "posDetail1"]) || fields[1] || ""),
    pos3: String(firstValue(objectFeature, ["pos3", "subpos2", "posDetail2"]) || fields[2] || ""),
    cType: String(firstValue(objectFeature, ["cType", "conjugationType"]) || fields[4] || ""),
    cForm: String(firstValue(objectFeature, ["cForm", "conjugationForm"]) || fields[5] || ""),
    lemma: String(firstValue(objectFeature, ["lemma", "orthBase", "baseForm"]) || fields[7] || fields[6] || node.surface),
    rawFeature: feature
  };
}

function mapPartOfSpeech(morpheme) {
  const description = [morpheme.pos, morpheme.pos2, morpheme.pos3].join(",");
  if (/補助記号|記号|空白/.test(description)) return "Punct";
  if (/助動詞/.test(description)) return "I";
  if (/動詞/.test(description)) return "V";
  if (/形容詞|形状詞/.test(description)) return "A";
  if (/副詞/.test(description)) return "Adv";
  if (/連体詞/.test(description)) return "Det";
  if (/接続詞/.test(description)) return "C";
  if (/助詞/.test(description)) return "P";
  if (/名詞|代名詞|固有名詞/.test(description)) return "N";
  return "Unknown";
}

export async function tokenize(input) {
  const mecab = await initializeMecab();
  const nodes = await mecab.parseToNodes(input);
  const output = [];

  for (const node of nodes) {
    const surface = firstValue(node, ["surface", "word", "literal", "string"]);
    if (!surface || /^(BOS|EOS)$/.test(surface)) continue;

    const feature = normalizeFeature({ ...node, surface });
    const pos = mapPartOfSpeech({ surface, ...feature });
    if (pos === "Punct") continue;

    output.push({
      surface,
      ...feature,
      pos,
      base: feature.lemma || surface,
      source: "MeCab / UniDic"
    });
  }

  return output;
}

const NOMINAL_MARKERS = new Set(["は", "が", "を", "も"]);
const POSTPOSITIONS = new Set(["に", "へ", "で", "と", "から", "まで", "より", "について", "によって"]);
const LINKERS = new Set(["て", "で"]);

function markerType(particle) {
  if (particle === "は") return "topic";
  if (particle === "が") return "nominative";
  if (particle === "を") return "accusative";
  if (particle === "も") return "additive";
  return "nominalMarker";
}

function isAuxiliaryVerb(token) {
  if (!token || token.pos !== "V") return false;
  return /補助/.test(`${token.pos2} ${token.pos3}`) ||
    ["いる", "居る", "ある", "おく", "しまう", "みる"].includes(token.base);
}

function makeInflection(parts) {
  return {
    surface: parts.map(part => part.surface).join(""),
    content: parts.map(part => part.surface).join(""),
    pos: "I",
    phraseCategory: "I",
    base: parts.map(part => part.base || part.surface).join("+"),
    particle: null,
    markerType: "inflectionSeries",
    complementCategory: null,
    parts,
    kind: "infl"
  };
}

export function group(tokens) {
  const output = [];

  for (let index = 0; index < tokens.length; index++) {
    const current = tokens[index];
    const next = tokens[index + 1];

    // サ変名詞 + する。ただし後続系列は次の反復でIへまとめる。
    if (
      current.pos === "N" &&
      next?.pos === "V" &&
      (/サ変/.test(`${current.pos2} ${next.cType}`) || /^(し|する|した)$/.test(next.surface))
    ) {
      output.push({
        surface: current.surface + next.surface,
        content: current.surface + next.surface,
        pos: "V",
        phraseCategory: "V",
        base: current.surface + "する",
        particle: null,
        markerType: null,
        complementCategory: null,
        parts: [current, next],
        kind: "predicate"
      });
      index++;
      continue;
    }

    // 語彙動詞の後の「て/で + 補助動詞 + 助動詞*」をI系列化する。
    // 知っ + て + いる -> V 知っ / I ている
    // 住ん + で + い + ます -> V 住ん / I でいます
    if (current.pos === "V" && next?.pos === "P" && LINKERS.has(next.surface)) {
      const auxiliary = tokens[index + 2];
      if (isAuxiliaryVerb(auxiliary)) {
        output.push({
          surface: current.surface,
          content: current.surface,
          pos: "V",
          phraseCategory: "V",
          base: current.base || current.surface,
          particle: null,
          markerType: null,
          complementCategory: null,
          parts: [current],
          kind: "predicate"
        });

        const inflectionParts = [next, auxiliary];
        let cursor = index + 3;
        while (tokens[cursor]?.pos === "I") {
          inflectionParts.push(tokens[cursor]);
          cursor++;
        }
        output.push(makeInflection(inflectionParts));
        index = cursor - 1;
        continue;
      }
    }

    // 単純な動詞 + 助動詞系列。走っ + た、食べ + ます。
    if (current.pos === "V" && next?.pos === "I") {
      output.push({
        surface: current.surface,
        content: current.surface,
        pos: "V",
        phraseCategory: "V",
        base: current.base || current.surface,
        particle: null,
        markerType: null,
        complementCategory: null,
        parts: [current],
        kind: "predicate"
      });

      const inflectionParts = [];
      let cursor = index + 1;
      while (tokens[cursor]?.pos === "I") {
        inflectionParts.push(tokens[cursor]);
        cursor++;
      }
      output.push(makeInflection(inflectionParts));
      index = cursor - 1;
      continue;
    }

    // 内容語 + 助詞。
    if (["N", "A", "Adv"].includes(current.pos) && next?.pos === "P") {
      const particle = next.surface;
      const category = NOMINAL_MARKERS.has(particle)
        ? "N"
        : POSTPOSITIONS.has(particle)
          ? "P"
          : current.pos;

      output.push({
        surface: current.surface + particle,
        content: current.surface,
        pos: category,
        phraseCategory: category,
        base: current.base || current.surface,
        particle,
        markerType: NOMINAL_MARKERS.has(particle) ? markerType(particle) : "postposition",
        complementCategory: current.pos,
        parts: [current, next],
        kind: category === "P" ? "postpositionalPhrase" : markerType(particle)
      });
      index++;
      continue;
    }

    output.push({
      surface: current.surface,
      content: current.surface,
      pos: current.pos,
      phraseCategory: current.pos,
      base: current.base || current.surface,
      particle: null,
      markerType: null,
      complementCategory: null,
      parts: [current],
      kind: current.pos === "I" ? "infl" : current.pos === "V" ? "predicate" : "word"
    });
  }

  return output;
}
