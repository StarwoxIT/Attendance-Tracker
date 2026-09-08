export interface AttendanceCounts {
  early: number;
  onTime: number;
  late: number;
}

export interface ScoreWeights {
  earlyPoints: number;
  onTimePoints: number;
  latePoints: number;
}

export interface AttendanceScore {
  markedDays: number;
  weightedSum: number;
  /** weightedSum / markedDays — 0 when there are no marked days. */
  averagePoints: number;
  /** averagePoints expressed as a % of the best possible per-day score, so an
   * employee who was early every day always scores 100 regardless of the weights. */
  percentage: number;
}

/**
 * Weighted daily-average performance score. Each attended day earns points for
 * arriving early, on time, or late (weights configurable in Attendance Settings,
 * defaulting to early=5 / on-time=3 / late=0 so earlier arrival always outranks
 * later). Averaging over days actually marked (not absences) keeps someone who
 * simply has fewer working days from being penalized for a smaller sample size.
 */
export function computeAttendanceScore(counts: AttendanceCounts, weights: ScoreWeights): AttendanceScore {
  const markedDays = counts.early + counts.onTime + counts.late;
  const weightedSum =
    counts.early * weights.earlyPoints + counts.onTime * weights.onTimePoints + counts.late * weights.latePoints;
  const averagePoints = markedDays > 0 ? weightedSum / markedDays : 0;
  const bestPossiblePerDay = Math.max(weights.earlyPoints, weights.onTimePoints, weights.latePoints, 1);
  const percentage = markedDays > 0 ? (averagePoints / bestPossiblePerDay) * 100 : 0;

  return { markedDays, weightedSum, averagePoints, percentage };
}
