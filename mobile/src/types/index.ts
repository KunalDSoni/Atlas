// Common type definitions for the Atlas mobile app

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  active: boolean;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  key: string;
  description?: string;
  avatar?: string;
  members: User[];
  owner: User;
  createdAt: string;
  updatedAt: string;
}

export type IssueType = 'Story' | 'Task' | 'Bug' | 'Epic' | 'Subtask';
export type IssuePriority = 'Lowest' | 'Low' | 'Medium' | 'High' | 'Highest';
export type IssueStatus = 'To Do' | 'In Progress' | 'In Review' | 'Done' | 'Blocked';
export type StatusCategory = 'To Do' | 'In Progress' | 'Done';

export interface Issue {
  id: string;
  key: string;
  title: string;
  description?: string;
  type: IssueType;
  priority: IssuePriority;
  status: IssueStatus;
  statusCategory: StatusCategory;
  assignee?: User;
  reporter: User;
  project: Project | string; // Can be project ID or full project object
  parent?: Issue | string; // For subtasks
  labels: string[];
  watchers: User[];
  comments: Comment[];
  attachments: Attachment[];
  links: IssueLink[];
  customFields?: Record<string, any>;
  storyPoints?: number;
  estimatedHours?: number;
  sprintId?: string;
  epicId?: string;
  createdAt: string;
  updatedAt: string;
  dueDates?: string;
}

export interface Comment {
  id: string;
  text: string;
  author: User;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
}

export interface Attachment {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  url: string;
  uploadedBy: User;
  uploadedAt: string;
}

export interface IssueLink {
  id: string;
  type: 'blocks' | 'relates to' | 'duplicates' | 'is duplicated by' | 'blocks' | 'is blocked by';
  linkedIssue: Issue | string;
  createdAt: string;
}

export interface Sprint {
  id: string;
  name: string;
  projectId: string;
  status: 'planned' | 'active' | 'completed';
  startDate: string;
  endDate: string;
  goal?: string;
  issues: Issue[];
  createdAt: string;
  updatedAt: string;
}

export interface Filter {
  id: string;
  name: string;
  projectId: string;
  criteria: FilterCriteria;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FilterCriteria {
  status?: IssueStatus[];
  priority?: IssuePriority[];
  assignee?: string[];
  type?: IssueType[];
  labels?: string[];
  sprint?: string;
  epic?: string;
  text?: string;
}

export interface Notification {
  id: string;
  type: 'issue_updated' | 'issue_commented' | 'issue_assigned' | 'mentioned' | 'issue_linked';
  title: string;
  message: string;
  read: boolean;
  actor: User;
  issue?: Issue;
  relatedUrl?: string;
  createdAt: string;
}

export interface Activity {
  id: string;
  type: string;
  actor: User;
  action: string;
  description: string;
  issue?: Issue;
  project?: Project;
  changes?: Record<string, any>;
  createdAt: string;
}

export interface CustomField {
  id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'checkbox';
  required: boolean;
  options?: string[]; // For select/multiselect
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileSettings {
  theme: 'light' | 'dark' | 'auto';
  notifyMentions: boolean;
  notifyAssigned: boolean;
  notifyComments: boolean;
  notifyWatching: boolean;
  language: string;
}

export interface BurndownData {
  sprintId: string;
  dates: string[];
  ideal: number[];
  actual: number[];
  completed: number[];
  remaining: number[];
}

export interface VelocityData {
  sprints: Array<{
    name: string;
    velocity: number;
    storyPoints: number;
  }>;
  averageVelocity: number;
  trend: number; // percentage change
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface ErrorResponse {
  code: string;
  message: string;
  details?: any;
}
