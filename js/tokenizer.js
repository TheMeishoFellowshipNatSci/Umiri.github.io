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
   * 「は」「が」「も」の付いた句は、
   * 現在の表示規約ではN系列に残す。
   *
   * 私 + は → 私は：N
   * 太郎 + が → 太郎が：N
   */
  if (NOMINAL_MARKERS.has(particle)) {
    return {
      category: "N",
      phraseCategory: "N",
      markerType:
        particle === "は"
          ? "topic"
          : particle === "が"
            ? "nominative"
            : "additive"
    };
  }

  /*
   * 格助詞・後置詞が主要部となる句はP系列。
   *
   * 公園 + で → 公園で：P
   * 岐阜 + に → 岐阜に：P
   * 本 + を   → 本を：P
   */
  if (POSTPOSITIONS.has(particle)) {
    return {
      category: "P",
      phraseCategory: "P",
      markerType: "postposition"
    };
  }

  /*
   * 未分類の助詞は、誤ってPと断定せず、
   * 元の語彙範疇を暫定的に保持する。
   */
  return {
    category: contentToken.pos,
    phraseCategory: contentToken.pos,
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
     * 内部では二形態素を保持しながら、
     * 投射経路では一つの表示単位にまとめる。
     */
    if (
      ["N", "A", "Adv"].includes(current.pos) &&
      next?.pos === "P"
    ) {
      const classification =
        classifyMarkedPhrase(current, next);

      output.push({
        surface:
          current.surface +
          next.surface,

        content: current.surface,

        /*
         * ここが重要。
         *
         * 私は   → N
         * 公園で → P
         * 岐阜に → P
         * 本を   → P
         */
        pos: classification.category,

        phraseCategory:
          classification.phraseCategory,

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
     * 結合しない通常の形態素
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
