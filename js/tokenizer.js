import { MecabWorker } from "mecab-web-worker";

let worker = null;

function dictionaryUrl() {
  return new URL(
    "./dictionaries/unidic-mecab-2.1.2_bin.zip",
    document.baseURI
  ).href;
}

export async function initializeMecab(
  onProgress = () => {}
) {
  if (worker) {
    return worker;
  }

  onProgress(
    "MeCab/WASMとUniDicを読み込んでいます…"
  );

  worker = await MecabWorker.create(dictionaryUrl());

  onProgress("MeCab/UniDic準備完了");

  return worker;
}

function firstValue(object, keys) {
  for (const key of keys) {
    const value = object?.[key];

    if (
      value !== undefined &&
      value !== null &&
      value !== "" &&
      value !== "*"
    ) {
      return value;
    }
  }

  return "";
}

function normalizeFeature(node) {
  const feature =
    node.feature ??
    node.features ??
    [];

  let fields = [];

  if (Array.isArray(feature)) {
    fields = feature;
  } else if (typeof feature === "string") {
    fields = feature.split(",");
  } else if (
    feature &&
    Array.isArray(feature.values)
  ) {
    fields = feature.values;
  }

  const objectFeature =
    feature &&
    typeof feature === "object" &&
    !Array.isArray(feature)
      ? feature
      : {};

  const pos =
    firstValue(objectFeature, [
      "pos1",
      "pos",
      "partOfSpeech"
    ]) ||
    fields[0] ||
    "未知語";

  const pos2 =
    firstValue(objectFeature, [
      "pos2",
      "subpos1",
      "posDetail1"
    ]) ||
    fields[1] ||
    "";

  const pos3 =
    firstValue(objectFeature, [
      "pos3",
      "subpos2",
      "posDetail2"
    ]) ||
    fields[2] ||
    "";

  const cType =
    firstValue(objectFeature, [
      "cType",
      "conjugationType"
    ]) ||
    fields[4] ||
    "";

  const cForm =
    firstValue(objectFeature, [
      "cForm",
      "conjugationForm"
    ]) ||
    fields[5] ||
    "";

  const lemma =
    firstValue(objectFeature, [
      "lemma",
      "orthBase",
      "baseForm"
    ]) ||
    fields[7] ||
    fields[6] ||
    node.surface;

  return {
    pos: String(pos),
    pos2: String(pos2),
    pos3: String(pos3),
    cType: String(cType),
    cForm: String(cForm),
    lemma: String(lemma),
    rawFeature: feature
  };
}

function mapPartOfSpeech(morpheme) {
  const description = [
    morpheme.pos,
    morpheme.pos2,
    morpheme.pos3
  ].join(",");

  if (/補助記号|記号|空白/.test(description)) {
    return "Punct";
  }

  if (/助動詞/.test(description)) {
    return "I";
  }

  if (/動詞/.test(description)) {
    return "V";
  }

  if (/形容詞|形状詞/.test(description)) {
    return "A";
  }

  if (/副詞/.test(description)) {
    return "Adv";
  }

  if (/連体詞/.test(description)) {
    return "Det";
  }

  if (/接続詞/.test(description)) {
    return "C";
  }

  if (/助詞/.test(description)) {
    if (
      /終助詞|接続助詞/.test(description) ||
      ["か", "ので", "のに", "けれど"].includes(
        morpheme.surface
      )
    ) {
      return "C";
    }

    return "P";
  }

  if (/名詞|代名詞|固有名詞/.test(description)) {
    return "N";
  }

  return "Unknown";
}

export async function tokenize(input) {
  const mecab = await initializeMecab();
  const nodes = await mecab.parseToNodes(input);
  const output = [];

  for (const node of nodes) {
    const surface = firstValue(node, [
      "surface",
      "word",
      "literal",
      "string"
    ]);

    if (
      !surface ||
      /^(BOS|EOS)$/.test(surface)
    ) {
      continue;
    }

    const feature = normalizeFeature({
      ...node,
      surface
    });

    const pos = mapPartOfSpeech({
      surface,
      ...feature
    });

    if (pos === "Punct") {
      continue;
    }

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

export function group(tokens) {
  const output = [];

  for (
    let index = 0;
    index < tokens.length;
    index++
  ) {
    const current = tokens[index];
    const next = tokens[index + 1];

    /*
     * サ変名詞 + 「する」の活用形
     *
     * 例：
     * 勉強 + し → 勉強し
     * 解析 + する → 解析する
     */
    if (
      current.pos === "N" &&
      next?.pos === "V" &&
      (
        /サ変/.test(
          `${current.pos2} ${next.cType}`
        ) ||
        /^(し|する|した)$/.test(next.surface)
      )
    ) {
      output.push({
        surface:
          current.surface +
          next.surface,

        content:
          current.surface +
          next.surface,

        pos: "V",
        base: current.surface + "する",
        parts: [current, next],
        kind: "predicate"
      });

      index++;
      continue;
    }

    /*
     * 内容語 + 助詞
     *
     * 内部では形態素を分けたまま保持し、
     * 投射経路の表示上は一単位へまとめる。
     *
     * 例：
     * 私 + は → 私は
     * 公園 + で → 公園で
     */
    if (
      ["N", "A", "Adv"].includes(current.pos) &&
      next?.pos === "P"
    ) {
      output.push({
        surface:
          current.surface +
          next.surface,

        content: current.surface,
        pos: current.pos,
        base:
          current.base ||
          current.surface,

        particle: next.surface,
        parts: [current, next],

        kind:
          next.surface === "は"
            ? "topic"
            : "case"
      });

      index++;
      continue;
    }

    output.push({
      surface: current.surface,
      content: current.surface,
      pos: current.pos,

      base:
        current.base ||
        current.surface,

      parts: [current],

      kind:
        current.pos === "I"
          ? "infl"
          : current.pos === "V"
            ? "predicate"
            : "word"
    });
  }

  return output;
}
