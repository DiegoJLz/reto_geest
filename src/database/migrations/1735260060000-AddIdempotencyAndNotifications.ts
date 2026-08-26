import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIdempotencyAndNotifications1735260060000 implements MigrationInterface {
  name = 'AddIdempotencyAndNotifications1735260060000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- notification_attempts ----
    await queryRunner.query(`
      CREATE TABLE "notification_attempts" (
        "id" BIGSERIAL PRIMARY KEY,
        "task_id" BIGINT NOT NULL,
        "attempt_number" INTEGER NOT NULL,
        "status_code" INTEGER,
        "error_message" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_notification_attempts_task"
          FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_notification_attempts_task" ON "notification_attempts" ("task_id")`,
    );

    // ---- idempotency_keys ----
    await queryRunner.query(`
      CREATE TABLE "idempotency_keys" (
        "key" VARCHAR(200) NOT NULL,
        "endpoint" VARCHAR(100) NOT NULL,
        "request_hash" CHAR(64) NOT NULL,
        "status" VARCHAR(20) NOT NULL DEFAULT 'processing',
        "status_code" INTEGER,
        "response_body" JSONB,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMPTZ,
        PRIMARY KEY ("key", "endpoint"),
        CONSTRAINT "ck_idempotency_keys_status" CHECK ("status" IN ('processing', 'completed'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_idempotency_keys_created_at" ON "idempotency_keys" ("created_at")`,
    );

    // ---- audit M7: partial index for GET /users list pending query
    // Query pattern: WHERE user_id IN (...) AND completed_at IS NULL
    // Leading column must be user_id for this to help.
    await queryRunner.query(
      `CREATE INDEX "ix_task_assignments_user_pending" ON "task_assignments" ("user_id") WHERE "completed_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_task_assignments_user_pending"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "idempotency_keys"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_attempts"`);
  }
}
