-- BLOCK issues_count
WITH
  counts AS (
    SELECT
      i.open,
      count(*)::int
    FROM
      issues AS i
    WHERE
      i.course_id = $course_id
      AND i.course_caused
    GROUP BY
      i.open
  )
SELECT
  coalesce(count, 0) AS count
FROM
  (
    VALUES
      (true),
      (false)
  ) AS tmp (open)
  LEFT JOIN counts USING (open)
ORDER BY
  -- Returns two rows, the first is false (closed), the second is true (open)
  open;

-- BLOCK select_issues
WITH
  selected_issues AS (
    SELECT
      i.id AS issue_id
    FROM
      issues AS i
      LEFT JOIN questions AS q ON (q.id = i.question_id)
      LEFT JOIN users AS u ON (u.user_id = i.user_id)
      LEFT JOIN assessments AS a ON (a.id = i.assessment_id)
    WHERE
      i.course_id = $course_id
      AND (
        $filter_is_open::boolean IS NULL
        OR i.open = $filter_is_open::boolean
      )
      AND (
        $filter_is_closed::boolean IS NULL
        OR i.open != $filter_is_closed::boolean
      )
      AND (
        $filter_manually_reported::boolean IS NULL
        OR i.manually_reported = $filter_manually_reported::boolean
      )
      AND (
        $filter_automatically_reported::boolean IS NULL
        OR i.manually_reported != $filter_automatically_reported::boolean
      )
      AND (
        $filter_qids::text[] IS NULL
        OR q.qid ILIKE ANY ($filter_qids::text[])
      )
      AND (
        $filter_not_qids::text[] IS NULL
        OR q.qid NOT ILIKE ANY ($filter_not_qids::text[])
      )
      AND (
        $filter_users::text[] IS NULL
        OR u.uid ILIKE ANY ($filter_users::text[])
      )
      AND (
        $filter_not_users::text[] IS NULL
        OR u.uid NOT ILIKE ANY ($filter_not_users::text[])
      )
      AND (
        $filter_assessments::text[] IS NULL
        OR a.tid ILIKE ANY ($filter_assessments::text[])
      )
      AND (
        $filter_not_assessments::text[] IS NULL
        OR a.tid NOT ILIKE ANY ($filter_not_assessments::text[])
      )
      AND (
        $filter_query_text::text IS NULL
        OR to_tsvector(concat_ws(' ', q.qid, u.uid, i.student_message)) @@ plainto_tsquery($filter_query_text::text)
      )
  )
SELECT
  i.* AS issue_id,
  ci.short_name AS course_instance_short_name,
  ci.id AS course_instance_id,
  COALESCE(ci.display_timezone, c.display_timezone) AS display_timezone,
  a.id AS assessment_id,
  CASE
    WHEN i.assessment_id IS NOT NULL THEN assessments_format (i.assessment_id)
  END AS assessment,
  iq.assessment_instance_id,
  q.qid AS question_qid,
  u.uid AS user_uid,
  u.name AS user_name,
  u.email AS user_email,
  v.variant_seed,
  COUNT(*) OVER ()::INTEGER AS issue_count
FROM
  selected_issues
  JOIN issues AS i ON (i.id = selected_issues.issue_id)
  JOIN pl_courses AS c ON (c.id = i.course_id)
  LEFT JOIN course_instances AS ci ON (ci.id = i.course_instance_id)
  LEFT JOIN assessments AS a ON (a.id = i.assessment_id)
  LEFT JOIN questions AS q ON (q.id = i.question_id)
  LEFT JOIN users AS u ON (u.user_id = i.user_id)
  LEFT JOIN instance_questions AS iq ON (iq.id = i.instance_question_id)
  LEFT JOIN variants AS v ON (v.id = i.variant_id)
WHERE
  i.course_caused
ORDER BY
  i.date DESC,
  i.id DESC
LIMIT
  $limit
OFFSET
  $offset;

-- BLOCK close_issues
WITH
  updated_issues AS (
    UPDATE issues AS i
    SET
      open = FALSE
    WHERE
      i.course_id = $course_id
      AND i.course_caused
      AND i.open IS TRUE
      AND i.id = ANY ($issue_ids::BIGINT[])
    RETURNING
      i.id,
      i.open
  ),
  inserted_audit_logs AS (
    INSERT INTO
      audit_logs (
        authn_user_id,
        course_id,
        table_name,
        column_name,
        row_id,
        action,
        parameters,
        new_state
      )
    SELECT
      $authn_user_id,
      $course_id,
      'issues',
      'open',
      i.id,
      'update',
      jsonb_build_object('course_id', $course_id),
      jsonb_build_object('open', i.open)
    FROM
      updated_issues AS i
  )
SELECT
  COUNT(*)::integer
FROM
  updated_issues;

-- BLOCK update_issue_open
WITH
  previous_issue_data AS (
    SELECT
      i.*
    FROM
      issues AS i
    WHERE
      i.id = $issue_id
      AND i.course_caused
      AND i.course_id = $course_id
  ),
  updated_issue AS (
    UPDATE issues AS i
    SET
      open = $new_open
    FROM
      previous_issue_data AS pi
    WHERE
      i.id = pi.id
    RETURNING
      i.id
  ),
  inserted_audit_logs AS (
    INSERT INTO
      audit_logs (
        authn_user_id,
        course_id,
        table_name,
        column_name,
        row_id,
        action,
        parameters,
        old_state,
        new_state
      )
    SELECT
      $authn_user_id,
      pi.course_id,
      'issues',
      'open',
      pi.id,
      'update',
      jsonb_build_object('open', $new_open),
      jsonb_build_object('open', pi.open),
      jsonb_build_object('open', $new_open)
    FROM
      previous_issue_data AS pi
  )
SELECT
  id
FROM
  updated_issue;
