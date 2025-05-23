import type { HtmlValue } from '@prairielearn/html';

export type NavbarType =
  | 'plain'
  | 'student'
  | 'instructor'
  | 'administrator_institution'
  | 'institution'
  | 'public'
  | undefined;

export type NavPage =
  | 'public_assessment'
  | 'public_question'
  | 'public_questions'
  | 'instance_admin'
  | 'course_admin'
  | 'assessment'
  | 'question'
  | 'admin'
  | 'administrator_institution'
  | 'institution_admin'
  | 'assessments'
  | 'gradebook'
  | 'assessment_instance'
  | 'effective'
  | 'lti13_course_navigation'
  | 'error'
  | 'enroll'
  | 'request_course'
  | 'home'
  | 'news_item'
  | 'news_items'
  | 'user_settings'
  | 'password'
  | undefined;

// This type is provisionally very lenient, to avoid problems with existing
// code. A future version where navSubPage is more strictly defined can set
// this to a more specific enum-like type.
export type NavSubPage = string | undefined;

export interface NavContext {
  type: NavbarType;
  page: NavPage;
  subPage?: NavSubPage;
}

export interface TabInfo {
  activeSubPage: NavSubPage | NavSubPage[];
  urlSuffix: string | ((resLocals: Record<string, any>) => string);
  iconClasses: string;
  tabLabel: string;
  htmlSuffix?: (resLocals: Record<string, any>) => HtmlValue;
  renderCondition?: (resLocals: Record<string, any>) => boolean;
}
