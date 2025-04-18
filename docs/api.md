# API

PrairieLearn contains a limited read-only API for use by instructors that
allows programmatic access to assessments, assessment instances, and
submissions.

## API Authentication

PrairieLearn uses personal access tokens for the API. To generate a personal
access token, click on your name in the nav bar and click "Settings". Under
the section entitled "Personal Access Tokens", you can generate tokens for
yourself. These tokens give you all the permissions that your normal user
account has.

Provide your token via the `Private-Token` header:

```sh
curl -H "Private-Token: TOKEN" https://us.prairielearn.com/pl/api/v1/<REST_OF_PATH>
```

## Example access script

An example script that will download all API data for a course instance is at [`api_download.py`](https://github.com/PrairieLearn/PrairieLearn/blob/master/contrib/api_download.py). You can use it like this:

```sh
python api_download.py --token 9a6932a1-e356-4ddc-ad82-4cf30ad896ac --course-instance-id 29832 --output-dir tam212fa18
```

The `token` is your personal access token described above. The `course-instance-id` can be obtained by navigating to your course instance in the PrairieLearn web interface and extracting the ID from the URL.

## Endpoints

All API endpoints are located at `/pl/api/v1/`. If you're running on
production PrairieLearn, that means the API is at
<https://us.prairielearn.com/pl/api/v1>. If you're running it locally
at port 3000, the API is accessible via <http://localhost:3000/pl/api/v1/>.

In the endpoint list below, path components starting with a colon like
`:course_instance_id` should be replaced with the integer IDs.

- **Course instance info:**

  - `/pl/api/v1/course_instances/:course_instance_id`
  - Information about the course instance.

- **Gradebook:**

  - `/pl/api/v1/course_instances/:course_instance_id/gradebook`
  - All of the data available in the course gradebook, with one entry per user containing summary data on all assessments.

- **Course instance access rules list:**

  - `/pl/api/v1/course_instances/:course_instance_id/course_instance_access_rules`
  - All access rules for the course instance.

- **Assessments list:**

  - `/pl/api/v1/course_instances/:course_instance_id/assessments`
  - All assessments in the course instance.

- **Single assessment:**

  - `/pl/api/v1/course_instances/:course_instance_id/assessments/:assessment_id`
  - One specific assessment.

- **Assessment instances list:**

  - `/pl/api/v1/course_instances/:course_instance_id/assessments/:assessment_id/assessment_instances`
  - All assessment instances for a given assessment.

- **Assessment access rules list:**

  - `/pl/api/v1/course_instances/:course_instance_id/assessments/:assessment_id/assessment_access_rules`
  - All assessment access rules for a given assessment.

- **One assessment instance:**

  - `/pl/api/v1/course_instances/:course_instance_id/assessment_instances/:assessment_instance_id`
  - One specific assessment instance.

- **Instance questions list:**

  - `/pl/api/v1/course_instances/:course_instance_id/assessment_instances/:assessment_instance_id/instance_questions`
  - All instance questions for a given assessment instance.

- **Submissions list:**

  - `/pl/api/v1/course_instances/:course_instance_id/assessment_instances/:assessment_instance_id/submissions`
  - All submissions for a given assessment instance.

- **Assessment Instance Event Log:**

  - `/pl/api/v1/course_instances/:course_instance_id/assessment_instances/:assessment_instance_id/log`
  - Retrieves the event log for a specific assessment.

- **One submission:**
  - `/pl/api/v1/course_instances/:course_instance_id/submissions/:submission_id`
  - One specific submission.
