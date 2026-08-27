Feature: Runtime and infrastructure inspection
  Operators can inspect the health of runners, shards, schedules, and singleton ownership.

  Scenario: inspect runner health
    Given I am on the "runners" route
    Then I can see "stale"
    And I can see "Load"
    And the page has no application errors

  Scenario: inspect shard ownership
    Given I am on the "shards" route
    Then I can see "assigned"
    And the page has no application errors

  Scenario: inspect scheduled work
    Given I am on the "crons" route
    Then I can see "next"
    And the page has no application errors

  Scenario: inspect runtime singleton state
    Given I am on the "singletons" route
    Then I can see "Singletons"
    And the page has no application errors
