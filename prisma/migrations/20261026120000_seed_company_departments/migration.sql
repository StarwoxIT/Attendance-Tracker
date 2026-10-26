-- Data migration: the company's departments. There is no other way departments
-- reach production, so without these the employee Department dropdown is empty.
-- ON CONFLICT keeps this safe where a department of the same name already exists.
INSERT INTO "departments" ("id", "name", "createdAt", "updatedAt")
VALUES
  ('dept_' || md5('Creative Department'), 'Creative Department', NOW(), NOW()),
  ('dept_' || md5('Development (Dev) Team'), 'Development (Dev) Team', NOW(), NOW()),
  ('dept_' || md5('Data Team'), 'Data Team', NOW(), NOW()),
  ('dept_' || md5('Engineering'), 'Engineering', NOW(), NOW()),
  ('dept_' || md5('Administrative Assistance'), 'Administrative Assistance', NOW(), NOW()),
  ('dept_' || md5('HR'), 'HR', NOW(), NOW()),
  ('dept_' || md5('Operations'), 'Operations', NOW(), NOW()),
  ('dept_' || md5('Finance'), 'Finance', NOW(), NOW()),
  ('dept_' || md5('Logistics'), 'Logistics', NOW(), NOW())
ON CONFLICT ("name") DO NOTHING;
