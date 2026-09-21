export interface AnalyticsSummary {
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  overdueTasks: number;
  completionRatePercent: number;
  createdLast7d: number;
  completedLast7d: number;
  activeProjectsCount: number;
  activeUsersCount: number;
}

export interface TrendDataPoint {
  date: string;
  createdCount: number;
  completedCount: number;
}

export interface ProjectDistribution {
  projectId: number;
  projectName: string;
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  progressPercent: number;
}

export interface UserWorkload {
  userId: number;
  userName: string;
  userLogin: string;
  assignedTasks: number;
  completedTasks: number;
}

export type WorkloadSortColumn = 'name' | 'login' | 'assigned' | 'completed' | 'efficiency';
export type SortDirection = 'asc' | 'desc';

export interface ChartPoint {
  x: number;
  yCreated: number;
  yCompleted: number;
  label: string;
  date: string;
  created: number;
  completed: number;
}

export interface YAxisTick {
  y: number;
  value: number;
}
