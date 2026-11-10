import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Setup questions can base their answer on several documents. Each stored question's single
 * `linkedDocument` (in `organizations.settings->'setup'`, both in `questions` and in
 * `recentlyRemoved[].question`) becomes `linkedDocuments`, a list of one.
 *
 * The code reads both shapes, so it works before and after this runs. `down` keeps only the first
 * linked document of each question: questions linked to more lose the others.
 */
const toMany = (q: string) => `
  CASE
    WHEN jsonb_typeof(${q}->'linkedDocument') = 'object' AND NOT ${q} ? 'linkedDocuments'
      THEN (${q} - 'linkedDocument')
        || jsonb_build_object('linkedDocuments', jsonb_build_array(${q}->'linkedDocument'))
    ELSE ${q} - 'linkedDocument'
  END`;

const toOne = (q: string) => `
  CASE
    WHEN jsonb_typeof(${q}->'linkedDocuments') = 'array'
      AND jsonb_array_length(${q}->'linkedDocuments') > 0
      THEN (${q} - 'linkedDocuments')
        || jsonb_build_object('linkedDocument', ${q}->'linkedDocuments'->0)
    ELSE ${q} - 'linkedDocuments'
  END`;

/** Rewrites every question of every organization's setup with `rewrite`, where `key` is present. */
const rewriteQuestions = (rewrite: (q: string) => string, key: string) => [
  `UPDATE organizations o
      SET settings = jsonb_set(
        o.settings,
        '{setup,questions}',
        (SELECT COALESCE(jsonb_agg(${rewrite("t.q")} ORDER BY t.ord), '[]'::jsonb)
           FROM jsonb_array_elements(o.settings->'setup'->'questions') WITH ORDINALITY AS t(q, ord))
      )
    WHERE jsonb_typeof(o.settings->'setup'->'questions') = 'array'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(o.settings->'setup'->'questions') AS e(q)
         WHERE e.q ? '${key}'
      )`,
  `UPDATE organizations o
      SET settings = jsonb_set(
        o.settings,
        '{setup,recentlyRemoved}',
        (SELECT COALESCE(
                  jsonb_agg(jsonb_set(t.r, '{question}', ${rewrite("(t.r->'question')")}) ORDER BY t.ord),
                  '[]'::jsonb)
           FROM jsonb_array_elements(o.settings->'setup'->'recentlyRemoved') WITH ORDINALITY AS t(r, ord))
      )
    WHERE jsonb_typeof(o.settings->'setup'->'recentlyRemoved') = 'array'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(o.settings->'setup'->'recentlyRemoved') AS e(r)
         WHERE e.r->'question' ? '${key}'
      )`,
];

export class LinkManySetupDocuments1794700000000 implements MigrationInterface {
  name = "LinkManySetupDocuments1794700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of rewriteQuestions(toMany, "linkedDocument")) await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of rewriteQuestions(toOne, "linkedDocuments")) await queryRunner.query(sql);
  }
}
