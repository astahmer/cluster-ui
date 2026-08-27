@redis
Feature: Redis queue operations
  Operators can inspect individual BullMQ jobs instead of relying on aggregate counts.

  Background:
    Given I am on the "queues" route
    When I switch to the "local-redis" cluster

  Scenario: browse jobs in a queue
    When I browse the "emails" queue jobs
    Then the queue jobs browser is visible
    And I can see "emails jobs"
    And I can see "completed"

  Scenario: inspect a queue job
    When I browse the "emails" queue jobs
    And I inspect the first queue job
    Then the queue job detail dialog is visible
    And I can see "Input"
    And the page has no application errors

  Scenario: promote a delayed queue job
    When I browse the "emails" queue jobs
    And I choose the "delayed" queue-job state
    Then I can see "promote"
    When I promote the first delayed queue job
    Then I can see "Promoted"

  Scenario: pause and resume a queue
    When I pause the "payments" queue
    Then I can see "paused"
    When I resume the "payments" queue
    Then I can see "active"
