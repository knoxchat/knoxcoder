import AutonomousSlashCommand from "./autonomous";
import GenerateTerminalCommand from "./cmd";
import ChangelogCommand from "./changelog";
import CommitMessageCommand from "./commit";
import DraftIssueCommand from "./draftIssue";
import HooksSlashCommand from "./hooks";
import InitSlashCommand from "./init";
import InstructionsSlashCommand from "./instructions";
import HttpSlashCommand from "./http";
import PrDescriptionCommand from "./pr";
import ReviewMessageCommand from "./review";
import ShareSlashCommand from "./share";
import SkillsSlashCommand from "./skills";

export default [
  AutonomousSlashCommand,
  DraftIssueCommand,
  ShareSlashCommand,
  GenerateTerminalCommand,
  HttpSlashCommand,
  CommitMessageCommand,
  ReviewMessageCommand,
  PrDescriptionCommand,
  ChangelogCommand,
  SkillsSlashCommand,
  InitSlashCommand,
  InstructionsSlashCommand,
  HooksSlashCommand,
];
