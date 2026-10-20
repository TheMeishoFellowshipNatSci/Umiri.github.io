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

  worker = await MecabWorker.create(
    dictionaryUrl()
  );

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

  return {
    pos: String(
      firstValue(objectFeature, [
        "pos1",
        "pos",
        "partOfSpeech"
      ]) ||
        fields[0] ||
        "未知語"
    ),

    pos2: String(
      firstValue(objectFeature, [
        "pos2",
        "subpos1",
        "posDetail1"
      ]) ||
        fields[1] ||
        ""
    ),

    pos3: String(
      firstValue(objectFeature, [
        "pos3",
        "subpos2",
        "posDetail2"
      ]) ||
        fields[2] ||
        ""
    ),

    cType: String(
      firstValue(objectFeature, [
        "cType",
        "conjugationType"
      ]) ||
        fields[4] ||
        ""
    ),

    cForm: String(
      firstValue(objectFeature, [
        "cForm",
        "conjugationForm"
      ]) ||
        fields[5] ||
        ""
    ),

    lemma: String(
      firstValue(objectFeature, [
        "lemma",
        "orthBase",
        "baseForm"
      ]) ||
        fields[7] ||
        fields[6] ||
        node.surface
    ),

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

const POSTPOSITIONS = new Set([
  "を",
  "に",
  "へ",
  "で",
  "と",
  "から",
  "まで",
  "より",
  "について",
  "によって"
]);

const NOMINAL_MARKERS = new Set([
  "は",
  "が",
  "も"
]);

function classifyMarkedPhrase(
  contentToken,
  particleToken
) {
  const particle = particleToken.surface;

  /*
   * 「は」「が」「も」は現在の表示規約では
   * N系列に残す。
   */
  if (NOMINAL_MARKERS.has(particle)) {
    return {
      category: "N",

      markerType:
        particle === "は"
          ? "topic"
          : particle === "が"
            ? "nominative"
            : "additive"
    };
  }

  /*
   * 格助詞・後置詞を主要部とする句はP系列。
   */
  if (POSTPOSITIONS.has(particle)) {
    return {
      category: "P",
      markerType: "postposition"
    };
  }

  /*
   * 未分類助詞は元の範疇を暫定保持する。
   */
  return {
    category: contentToken.pos,
    markerType: "unclassified"
  };
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
     * サ変名詞＋する
     *
     * 勉強 + し → 勉強し
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
        phraseCategory: "V",
        base: current.surface + "する",

        particle: null,
        markerType: null,

        parts: [
          current,
          next
        ],

        kind: "predicate"
      });

      index++;
      continue;
    }

    /*
     * 内容語＋助詞
     *
     * 私 + は   → 私は：N
     * 公園 + で → 公園で：P
     * 岐阜 + に → 岐阜に：P
     */
    if (
      ["N", "A", "Adv"].includes(current.pos) &&
      next?.pos === "P"
    ) {
      const classification =
        classifyMarkedPhrase(
          current,
          next
        );

      output.push({
        surface:
          current.surface +
          next.surface,

        content: current.surface,

        pos: classification.category,

        phraseCategory:
          classification.category,

        base:
          current.base ||
          current.surface,

        particle: next.surface,

        markerType:
          classification.markerType,

        complementCategory:
          current.pos,

        parts: [
          current,
          next
        ],

        kind:
          classification.category === "P"
            ? "postpositionalPhrase"
            : classification.markerType
      });

      index++;
      continue;
    }

    /*
     * 通常の形態素
     */
    output.push({
      surface: current.surface,
      content: current.surface,

      pos: current.pos,
      phraseCategory: current.pos,

      base:
        current.base ||
        current.surface,

      particle: null,
      markerType: null,

      parts: [
        current
      ],

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
