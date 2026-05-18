/**
 * Query logging utility for profiling database access patterns
 * Helps identify N+1 query issues and query optimization opportunities
 */

interface QueryLog {
	query: string;
	duration: number;
	timestamp: number;
	context?: string;
}

class QueryLogger {
	private queries: QueryLog[] = [];
	private enabled = process.env.LOG_QUERIES === "true";

	log(query: string, durationMs: number, context?: string) {
		if (!this.enabled) return;

		this.queries.push({
			query,
			duration: durationMs,
			timestamp: Date.now(),
			context,
		});
	}

	reset() {
		this.queries = [];
	}

	getAll(): QueryLog[] {
		return [...this.queries];
	}

	getCount(): number {
		return this.queries.length;
	}

	getSummary() {
		return {
			totalQueries: this.queries.length,
			totalTime: this.queries.reduce((sum, q) => sum + q.duration, 0),
			byContext: this.queries.reduce(
				(acc, q) => {
					const ctx = q.context || "unknown";
					if (!acc[ctx]) {
						acc[ctx] = { count: 0, time: 0 };
					}
					acc[ctx].count++;
					acc[ctx].time += q.duration;
					return acc;
				},
				{} as Record<string, { count: number; time: number }>,
			),
		};
	}

	printSummary() {
		const summary = this.getSummary();
		console.log("\n=== Query Profiling Summary ===");
		console.log(`Total Queries: ${summary.totalQueries}`);
		console.log(`Total Time: ${summary.totalTime.toFixed(2)}ms`);
		console.log("\nBy Context:");
		Object.entries(summary.byContext).forEach(([ctx, stats]) => {
			console.log(`  ${ctx}: ${stats.count} queries, ${stats.time.toFixed(2)}ms`);
		});
		console.log("================================\n");
	}
}

export const queryLogger = new QueryLogger();
