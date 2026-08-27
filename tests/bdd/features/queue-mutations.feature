@redis
Feature: Redis queue mutations
  Operators can add jobs and safely clean terminal jobs from a queue.

  Background:
    Given I am on the "queues" route
    When I switch to the "local-redis" cluster

  Scenario: add a queue job from the dashboard
    When I open the add-job form for the "emails" queue
    And I add a job named "bdd-check"
    Then I can see "Job added to emails"

  Scenario: clean completed jobs with a limit
    When I open the clean form for the "emails" queue
    And I clean at most "1" completed job
    Then I can see "Removed"
