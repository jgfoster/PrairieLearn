-- BLOCK select_instance_questions_manual_grading
WITH
  issue_count AS (
    SELECT
      i.instance_question_id AS instance_question_id,
      count(*)::integer AS open_issue_count
    FROM
      issues AS i
    WHERE
      i.assessment_id = $assessment_id
      AND i.course_caused
      AND i.open
    GROUP BY
      i.instance_question_id
  )
SELECT
  iq.*,
  -- Convert modified_at to a text representation suitable for
  -- PostgreSQL so it can be properly interpreted when a grade
  -- update POST is received back.
  CAST(iq.modified_at AS TEXT) AS modified_at,
  ai.open AS assessment_open,
  COALESCE(u.uid, array_to_string(gul.uid_list, ', ')) AS uid,
  COALESCE(agu.name, agu.uid) AS assigned_grader_name,
  COALESCE(lgu.name, lgu.uid) AS last_grader_name,
  to_jsonb(aq.*) AS assessment_question,
  COALESCE(g.name, u.name) AS user_or_group_name,
  ic.open_issue_count,
  -- Pseudo-random deterministic stable order of instance questions. This will
  -- always return the same set of instance questions in the same order, but it
  -- is designed to reduce the impact of the order of the instance questions on
  -- individual students, which reduces bias. See
  -- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4603146
  ((iq.id % 21317) * 45989) % 3767 as iq_stable_order
FROM
  instance_questions AS iq
  JOIN assessment_instances AS ai ON (ai.id = iq.assessment_instance_id)
  JOIN assessment_questions AS aq ON (aq.id = iq.assessment_question_id)
  LEFT JOIN users AS u ON (u.user_id = ai.user_id)
  LEFT JOIN groups AS g ON (g.id = ai.group_id)
  LEFT JOIN groups_uid_list (g.id) AS gul ON TRUE
  LEFT JOIN users AS agu ON (agu.user_id = iq.assigned_grader)
  LEFT JOIN users AS lgu ON (lgu.user_id = iq.last_grader)
  LEFT JOIN issue_count AS ic ON (ic.instance_question_id = iq.id)
WHERE
  ai.assessment_id = $assessment_id
  AND iq.assessment_question_id = $assessment_question_id
  AND iq.status != 'unanswered'
ORDER BY
  iq_stable_order,
  iq.id;

-- BLOCK update_instance_questions
UPDATE instance_questions AS iq
SET
  requires_manual_grading = CASE
    WHEN $update_requires_manual_grading THEN $requires_manual_grading
    ELSE requires_manual_grading
  END,
  assigned_grader = CASE
    WHEN $update_assigned_grader THEN $assigned_grader
    ELSE assigned_grader
  END
WHERE
  iq.assessment_question_id = $assessment_question_id
  AND iq.id = ANY ($instance_question_ids::BIGINT[]);

-- BLOCK toggle_ai_grading_mode
UPDATE assessment_questions
SET
  ai_grading_mode = NOT ai_grading_mode
WHERE
  id = $assessment_question_id;
