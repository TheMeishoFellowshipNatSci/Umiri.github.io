import { MecabWorker } from "mecab-web-worker";

let worker = null;

/*
 * GitHub Pagesへ配置されたUniDic辞書のURLを生成する。
 *
 * document.baseURIを基準にすることで、
 * /Umiri.github.io/ のようなサブディレクトリ公開にも対応する。
 */
function dictionaryUrl() {
  return new URL(
    "./dictionaries/unidic-mecab-2.1.2_bin.zip",
    document.baseURI
  ).href;
}

/*
 * MeCab WebAssemblyとUniDicを初期化する。
 *
 * 一度生成したWorkerは再利用する。
 */
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

/*
 * オブジェクトから、候補キーを順番に調べて
 * 最初の有効な値を返す。
 */
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

/*
 * mecab-web-workerから返されるUniDic特徴量を
 * 共通形式へ正規化する。
 *
 * featureは次のいずれかで返る可能性がある。
 *
 * 1. 配列
 * 2. カンマ区切り文字列
 * 3. 名前付きプロパティを持つオブジェクト
 */
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

/*
 * UniDicの品詞を、Xバー解析器内の
 * 簡略範疇へ変換する。
 */
function mapPartOfSpeech(morpheme) {
  const description = [
    morpheme.pos,
    morpheme.pos2,
    morpheme.pos3
  ].join(",");

  if (
    /補助記号|記号|空白/.test(description)
  ) {
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
    /*
     * 終助詞や接続助詞は、
     * 現段階ではC系列の候補として扱う。
     */
    if (
      /終助詞|接続助詞/.test(description) ||
      [
        "か",
        "ので",
        "のに",
        "けれど"
      ].includes(morpheme.surface)
    ) {
      return "C";
    }

    return "P";
  }

  if (
    /名詞|代名詞|固有名詞/.test(description)
  ) {
    return "N";
  }

  /*
   * 判定不能な形態素を勝手に名詞へせず、
   * Unknownとして残す。
   */
  return "Unknown";
}

/*
 * 入力文をMeCabで形態素解析し、
 * Xバー解析器用のトークン配列へ変換する。
 */
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

    /*
     * BOS、EOS、空ノードは除外する。
     */
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

    /*
     * 句読点は現在の句構造表示から除外する。
     */
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

/*
 * N″として扱う標識。
 *
 * は：主題標識
 * が：主格標識
 * を：対格標識
 * も：添加・焦点標識
 *
 * 「ご飯を」は、P″ではなく、
 * 対格標識を持つN″として扱う。
 */
const NOMINAL_MARKERS = new Set([
  "は",
  "が",
  "を",
  "も"
]);

/*
 * Pを主要部とする後置詞句。
 *
 * 岐阜で   → P″
 * 東京へ   → P″
 * 駅から   → P″
 *
 * 「に」「と」は曖昧性があるが、
 * 現段階ではP″候補として扱う。
 * 後ほど動詞フレームに基づいて精密化する。
 */
const POSTPOSITIONS = new Set([
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

/*
 * 内容語＋助詞から作る句の範疇を決める。
 */
function classifyMarkedPhrase(
  contentToken,
  particleToken
) {
  const particle = particleToken.surface;

  /*
   * N″として扱う標識。
   *
   * 私 + は     → 私は：N″
   * 太郎 + が   → 太郎が：N″
   * ご飯 + を   → ご飯を：N″
   * 私 + も     → 私も：N″
   */
  if (NOMINAL_MARKERS.has(particle)) {
    let markerType = "nominalMarker";

    if (particle === "は") {
      markerType = "topic";
    } else if (particle === "が") {
      markerType = "nominative";
    } else if (particle === "を") {
      markerType = "accusative";
    } else if (particle === "も") {
      markerType = "additive";
    }

    return {
      category: "N",
      markerType
    };
  }

  /*
   * Pを主要部とする後置詞句。
   *
   * 岐阜 + で → 岐阜で：P″
   * 東京 + へ → 東京へ：P″
   * 駅 + から → 駅から：P″
   */
  if (POSTPOSITIONS.has(particle)) {
    return {
      category: "P",
      markerType: "postposition"
    };
  }

  /*
   * 未分類の助詞については、
   * P″やN″と断定せず、
   * 内容語の範疇を暫定的に維持する。
   */
  return {
    category: contentToken.pos,
    markerType: "unclassified"
  };
}

/*
 * 形態素列を統語表示単位へまとめる。
 *
 * 例：
 *
 * 私 + は       → 私は
 * ご飯 + を     → ご飯を
 * 岐阜 + で     → 岐阜で
 * 勉強 + し     → 勉強し
 */
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
     * サ変名詞＋「する」の活用形。
     *
     * 勉強 + し   → 勉強し
     * 解析 + する → 解析する
     */
    if (
      current.pos === "N" &&
      next?.pos === "V" &&
      (
        /サ変/.test(
          `${current.pos2} ${next.cType}`
        ) ||
        /^(し|する|した)$/.test(
          next.surface
        )
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

        complementCategory: null,

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
     * 内容語＋助詞。
     *
     * 内部では二つの形態素を保持したまま、
     * 表示単位としてまとめる。
     */
    if (
      ["N", "A", "Adv"].includes(
        current.pos
      ) &&
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

        /*
         * 私は   → N
         * 太郎が → N
         * ご飯を → N
         * 岐阜で → P
         */
        pos: classification.category,

        phraseCategory:
          classification.category,

        base:
          current.base ||
          current.surface,

        particle: next.surface,

        markerType:
          classification.markerType,

        /*
         * P″の内部を展開するときに使用する。
         *
         * 岐阜で：
         * P″ → P′
         * P′ → N″ P
         */
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
     * 結合しない通常の形態素。
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
      complementCategory: null,

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
