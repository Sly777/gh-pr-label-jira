import * as core from "@actions/core";
import * as github from "@actions/github";
import { last } from "lodash-es";
import JiraApi from "jira-client";
import * as operations from "./operations";

enum IssueKeyLocation {
  BRANCH_NAME = "branch",
  TITLE = "title",
  BOTH = "both",
}

// reference: https://confluence.atlassian.com/adminjiraserver/changing-the-project-key-format-938847081.html
let JIRA_ISSUE_KEY_REGEX_MATCHER = /([A-Z]+[A-Z0-9_]*-\d+)/g;

async function main() {
  try {
    const githubToken = core.getInput("github-token", { required: true });
    const jiraUsername = core.getInput("jira-username", { required: true });
    const jiraApiKey = core.getInput("jira-api-token", { required: true });
    const jiraBaseUrl = core.getInput("jira-base-url", { required: true });
    const issueKeyLocation = core.getInput("issue-key-location", {
      required: false,
    }) as IssueKeyLocation;
    const syncIssueType = core.getBooleanInput("sync-issue-type", {
      required: false,
    });
    const syncIssuePriority = core.getBooleanInput("sync-issue-priority", {
      required: false,
    });
    const syncIssueLabels = core.getBooleanInput("sync-issue-labels", {
      required: false,
    });
    const regexInput = core.getInput("ticket-regex", { required: false });
    let labelPrefix = core.getInput("label-prefix", { required: false });

    if (regexInput) {
      JIRA_ISSUE_KEY_REGEX_MATCHER = new RegExp(regexInput, "g");
    }

    if (labelPrefix) {
      labelPrefix += " - ";
    }

    const context = github.context;

    const jiraBaseUrlParts = new URL(jiraBaseUrl);

    const jira = new JiraApi({
      protocol: jiraBaseUrlParts.protocol,
      host: jiraBaseUrlParts.host,
      username: jiraUsername,
      password: jiraApiKey,
      apiVersion: "2",
      strictSSL: true,
    });

    const title = context.payload.pull_request?.title;
    const branchName = context.ref;
    const prNumber = context.payload.pull_request?.number;

    core.debug(`PR title: ${title}`);
    core.debug(`Branch name: ${branchName}`);
    core.debug(`PR number: ${prNumber}`);

    if (!prNumber) {
      const msg = `No PR number was found in the GitHub context`;
      core.setFailed(msg);
      throw new Error(msg);
    }

    let jiraIssueKey;
    const matcher = new RegExp(JIRA_ISSUE_KEY_REGEX_MATCHER);
    if (issueKeyLocation === IssueKeyLocation.BRANCH_NAME) {
      jiraIssueKey = matcher.exec(branchName);
    } else if (issueKeyLocation === IssueKeyLocation.TITLE) {
      jiraIssueKey = matcher.exec(title);
    } else if (issueKeyLocation === IssueKeyLocation.BOTH) {
      jiraIssueKey = matcher.exec(title) || matcher.exec(branchName);
    }

    jiraIssueKey = last(jiraIssueKey);

    core.debug(`Jira issue key: ${jiraIssueKey}`);

    if (!jiraIssueKey) {
      const msg = `No Jira issue key was found in: ${issueKeyLocation}`;
      core.setFailed(msg);
      throw new Error(msg);
    }

    // fetch issue details with only the specified fields
    // the 2nd parameter (`names`) returns a property that has the "display name" of each property
    const jiraIssueDetails = (await jira.findIssue(
      jiraIssueKey,
      "names",
      "issuetype,priority,labels,fixVersions,status"
    )) as JiraIssue;

    const issueType = jiraIssueDetails.fields.issuetype?.name;
    const issuePriority = jiraIssueDetails.fields.priority?.name;
    const issueLabels = jiraIssueDetails.fields.labels;
    const issueFixVersions = jiraIssueDetails.fields.fixVersions?.map(
      (fixVersion) => fixVersion.name
    );
    const issueStatus = jiraIssueDetails.fields.status;

    core.debug(`From Jira, issue type: ${issueType}`);
    core.debug(`From Jira, priority: ${issuePriority}`);
    core.debug(`From Jira, labels: ${issueLabels}`);
    core.debug(`From Jira, fix versions: ${issueFixVersions}`);
    core.debug(`From Jira, ticket status: ${issueStatus}`);

    const octokit = github.getOctokit(githubToken);

    const operationInput = {
      jiraIssueDetails,
      githubPrNumber: prNumber,
      githubClient: octokit,
      githubContext: context,
      labelPrefix: labelPrefix,
    };

    if (syncIssueType) {
      await operations.syncIssueType(operationInput);
    }

    if (syncIssuePriority) {
      await operations.syncPriority(operationInput);
    }

    if (syncIssueLabels) {
      await operations.syncLabels(operationInput);
    }

    core.setOutput("issue-key", jiraIssueKey);
    core.setOutput("issue-type", issueType);
    core.setOutput("issue-priority", issuePriority);
    core.setOutput("issue-labels", issueLabels);
    core.setOutput("issue-fix-version", issueFixVersions);
    core.setOutput("issue-status", issueStatus);
  } catch (error: any) {
    core.setFailed(error.message);
  }
}

// this is a work-around to allow top-level await
main();
