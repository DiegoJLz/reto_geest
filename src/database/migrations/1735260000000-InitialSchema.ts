import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1735260000000 implements MigrationInterface {
  name = 'InitialSchema1735260000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- users ----
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" BIGSERIAL PRIMARY KEY,
        "name" VARCHAR(120) NOT NULL,
        "last_name" VARCHAR(120) NOT NULL,
        "email" VARCHAR(255) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "ux_users_email" ON "users" ("email")`);

    // ---- tasks ----
    await queryRunner.query(`
      CREATE TABLE "tasks" (
        "id" BIGSERIAL PRIMARY KEY,
        "title" VARCHAR(200) NOT NULL,
        "description" TEXT,
        "status" VARCHAR(16) NOT NULL DEFAULT 'open',
        "archived_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "ck_tasks_status" CHECK ("status" IN ('open', 'archived'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "ix_tasks_status" ON "tasks" ("status")`);

    // ---- task_assignments (join table with completion state) ----
    await queryRunner.query(`
      CREATE TABLE "task_assignments" (
        "task_id" BIGINT NOT NULL,
        "user_id" BIGINT NOT NULL,
        "completed_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY ("task_id", "user_id"),
        CONSTRAINT "fk_task_assignments_task"
          FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_task_assignments_user"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_task_assignments_user" ON "task_assignments" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_task_assignments_task_pending" ON "task_assignments" ("task_id") WHERE "completed_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "task_assignments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tasks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
