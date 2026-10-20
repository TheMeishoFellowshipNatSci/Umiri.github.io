import { frames } from "./lexicon.js";

let id = 0;

const createNode = (
  label,
  children = [],
  surface = null,
  metadata = {}
) => ({
  id: ++id,
  label,
  children,
  surface,
  metadata
});

function projectLexicalItem(category, group) {
  return createNode(
    category + "″",
    [
      createNode(
        category + "′",
        [
          createNode(
            category,
            [],
            group.surface,
            {
              base: group.base,
              particle: group.particle,
              markerType: group.markerType,
              parts: group.parts
            }
          )
        ]
      )
    ],
    null,
    {
      phraseCategory: category,
      surfaceUnit: group.surface
    }
  );
}

function projectGroup(group) {
  const category =
    group.phraseCategory ||
    group.pos ||
    "Unknown";

  return projectLexicalItem(
    category,
    group
  );
}

function defaultFrame() {
  return {
    required: [],
    optional: [
      "が",
      "は",
      "を",
      "に",
      "へ",
      "で",
      "と",
      "から",
      "まで"
    ],
    gloss: "未登録動詞・汎用フレーム"
  };
}

export function parse(groups) {
  id = 0;

  const warnings = [];

  const predicateIndex = groups
    .map(group => group.pos)
    .lastIndexOf("V");

  if (predicateIndex < 0) {
    const fragmentNodes =
      groups.map(projectGroup);

    return {
      root: createNode(
        "C″",
        [
          createNode(
            "C′",
            [
              createNode(
                "I″",
                fragmentNodes
              )
            ]
          )
        ]
      ),

      warnings: [
        "動詞主要部がありません。"
      ],

      score: 40,

      frame: {
        gloss: "なし"
      },

      predicate: null
    };
  }

  const predicate =
    groups[predicateIndex];

  const before =
    groups.slice(0, predicateIndex);

  const after =
    groups.slice(predicateIndex + 1);

  const frame =
    frames[predicate.base] ||
    defaultFrame();

  const phrases = before.map(group => ({
    group,
    node: projectGroup(group)
  }));

  const subject =
    phrases.find(entry =>
      entry.group.pos === "N" &&
      ["は", "が"].includes(
        entry.group.particle
      )
    );

  const dependents = phrases
    .filter(entry => entry !== subject)
    .map(entry => entry.node);

  const verbPhrase =
    createNode(
      "V″",
      [
        createNode(
          "V′",
          [
            ...dependents,

            createNode(
              "V",
              [],
              predicate.surface,
              {
                base:
                  predicate.base,

                parts:
                  predicate.parts
              }
            )
          ]
        )
      ]
    );

  const inflection =
    after.find(group =>
      group.pos === "I"
    );

  const inflectionPhrase =
    createNode(
      "I″",
      [
        ...(subject
          ? [subject.node]
          : []),

        createNode(
          "I′",
          [
            verbPhrase,

            createNode(
              "I",
              [],
              inflection?.surface ||
                "∅"
            )
          ]
        )
      ]
    );

  const complementizer =
    after.find(group =>
      group.pos === "C"
    );

  const clause =
    createNode(
      "C″",
      [
        createNode(
          "C′",
          [
            inflectionPhrase,

            createNode(
              "C",
              [],
              complementizer?.surface ||
                "∅"
            )
          ]
        )
      ]
    );

  const particles = new Set(
    before
      .map(group => group.particle)
      .filter(Boolean)
  );

  for (
    const requiredParticle
    of frame.required
  ) {
    if (
      !particles.has(requiredParticle)
    ) {
      warnings.push(
        `「${predicate.base}」が要求する` +
        `「${requiredParticle}」格がありません。`
      );
    }
  }

  if (!subject) {
    warnings.push(
      "表面上の主題・主語がありません。"
    );
  }

  if (
    frame.gloss.startsWith("未登録")
  ) {
    warnings.push(
      "動詞フレームが未登録です。"
    );
  }

  return {
    root: clause,
    warnings,

    score: Math.max(
      25,
      96 - warnings.length * 12
    ),

    frame,
    predicate
  };
}

export function paths(root) {
  const output = [];

  function walk(node, parentPath = []) {
    const currentPath = [
      ...parentPath,
      node.label
    ];

    if (node.surface !== null) {
      if (node.surface !== "∅") {
        output.push({
          path: currentPath,
          surface: node.surface
        });
      }

      return;
    }

    for (const child of node.children) {
      walk(child, currentPath);
    }
  }

  walk(root);

  return output;
}

export function brackets(node) {
  if (node.surface !== null) {
    return `[${node.label} ${node.surface}]`;
  }

  return (
    `[${node.label}` +
    (
      node.children.length
        ? " " +
          node.children
            .map(brackets)
            .join(" ")
        : ""
    ) +
    "]"
  );
}
