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
    *
  }

  return "";
}

function nor*(node) {
  const feature = node.fe*ture ?? node.features ?? [];

  le* fields = [];

  if (Array.isArray*feature)) {
    fields = feature;
* } else if (typeof feature === "st*ing") {
    fields = feature.split*",");
  } else if (
    feature &&*    Array.isArray(feature.values)
* ) {
    fields = feature.values;
* }

  const objectFeature =
    fe*ture &&
    typeof feature === "ob*ect" &&
    !Array.isArray(feature*
      ? feature
      : {};

  re*urn {
    pos: String(
      first*alue(objectFeature, [
        "pos1",
        "pos",
        "partOfSpeech"
      ]) ||
        fields[0] ||
        "未知語"
    ),

    pos2* String(
      firstValue(objectFe*ture, [
        "pos2",
        "subpos1",
        "posDetail1"
      ]) ||
        fields[1] ||
       *""
    ),

    pos3: String(
     *firstValue(objectFeature, [
        "pos3",
        "subpos2",
        "posDetail2"
      ]) ||
        *ields[2] ||
        ""
    ),

   *cType: String(
      firstValue(ob*ectFeature, [
        "cType",
        "conjugationType"
      ]) ||
*       fields[4] ||
        ""
   *),

    cForm: String(
      first*alue(objectFeature, [
        "cForm",
        "conjugationForm"
      ]) ||
        fields[5] ||
      * ""
    ),

    lemma: String(
   *  firstValue(objectFeature, [
        "lemma",
        "orthBase",
        "baseForm"
      ]) ||
      * fields[7] ||
        fields[6] ||*        node.surface
    ),

    r*wFeature: feature
  };
}

function*xp(morpheme) {
  const description*= [
    morpheme.pos,
    morpheme.pos2,
    morpheme.pos3
  ].join("*");

  if (/補助記号|記号|空白/.test(descr*ption)) {
    return "Punct";
  }
*  if (/助動詞/.test(description)) {
 *  return "I";
  }

  if (/動詞/.test*description)) {
    return "V";
  *

  if (/形容詞|形状詞/.test(description*) {
    return "A";
  }

  if (/副詞*.test(description)) {
    return "*dv";
  }

  if (/連体詞/.test(descrip*ion)) {
    return "Det";
  }

  i* (/接続詞/.test(description)) {
    r*turn "C";
  }

  if (/助詞/.test(des*ription)) {
    if (
      /終助詞|接続*詞/.test(description) ||
      ["か", "ので", "のに", "けれど"].includes(
    *   morpheme.surface
      )
    ) *
      return "C";
    }

    retu*n "P";
  }

  if (/名詞|代名詞|固有名詞/.te*t(description)) {
    return "N";
* }

  return "Unknown";
}

export *sync function tokenize(input) {
  *onst mecab = await initializeMecab*);
  const nodes = await mecab.par*eToNodes(input);
  const output = *];

  for (const node of nodes) {
*   const surface = firstValue(node* [
      "surface",
      "word",
      "literal",
      "string"
    ]);

    if (!surface || /^(BOS|EO*)$/.test(surface)) {
      continu*;
    }

    const feature = norm(*
      ...node,
      surface
    *);

    const pos = xp({
      sur*ace,
      ...feature
    });

   *if (pos === "Punct") {
      conti*ue;
    }

    output.push({
     *surface,
      ...feature,
      p*s,
      base: feature.lemma || su*face,
      source: "MeCab / UniDi*"
    });
  }

  return output;
}
*export function group(tokens) {
  *onst output = [];

  for (let inde* = 0; index < tokens.length; index*+) {
    const current = tokens[index];
    const next = tokens[index + 1];

    if (
      current.pos *== "N" &&
      next?.pos === "V" *&
      (
        /サ変/.test(
     *    `${current.pos2} ${next.cType}*
        ) ||
        /^(し|する|した)$*.test(next.surface)
      )
    ) *
      output.push({
        surfa*e: current.surface + next.surface,*        pos: "V",
        base: cu*rent.surface + "する",
        parts* [current, next],
        kind: "p*edicate"
      });

      index++;*      continue;
    }

    if (
  *   ["N", "A", "Adv"].includes(curr*nt.pos) &&
      next?.pos === "P"*    ) {
      output.push({
      * surface: current.surface + next.s*rface,
        content: current.su*face,
        pos: current.pos,
  *     base: current.base || current*surface,
        particle: next.su*face,
        parts: [current, next],
        kind:
          next.su*face === "は"
            ? "topic"*            : "case"
      });

  *   index++;
      continue;
    }
*    output.push({
      surface: c*rrent.surface,
      pos: current.*os,
      base: current.base || cu*rent.surface,
      parts: [current],
      kind:
        current.pos*=== "I"
          ? "infl"
       *  : current.pos === "V"
          * ? "predicate"
            : "word*
    });
  }

  return output;
}
