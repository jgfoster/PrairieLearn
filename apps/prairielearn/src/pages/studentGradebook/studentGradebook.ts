import { Router } from 'express';
import asyncHandler from 'express-async-handler';

import { loadSqlEquiv, queryRows } from '@prairielearn/postgres';

import logPageView from '../../middlewares/logPageView.js';

import { StudentGradebook, StudentGradebookRowSchema } from './studentGradebook.html.js';

const sql = loadSqlEquiv(import.meta.url);
const router = Router();

router.use(logPageView('studentGradebook'));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await queryRows(
      sql.select_assessment_instances,
      {
        course_instance_id: res.locals.course_instance.id,
        user_id: res.locals.user.user_id,
        authz_data: res.locals.authz_data,
        req_date: res.locals.req_date,
      },
      StudentGradebookRowSchema,
    );
    res.send(StudentGradebook({ resLocals: res.locals, rows }));
  }),
);

export default router;
