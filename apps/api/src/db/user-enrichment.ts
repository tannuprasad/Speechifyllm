/**
 * User Statistics Utility - Batch loads user statistics (post/comment counts)
 *
 * Prevents N+1 query patterns by batch-loading all user statistics
 * in a single set of queries.
 */

import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./index";

const { posts, comments } = schema;

export interface UserWithoutStats {
	id: string;
	[key: string]: unknown;
}

export interface UserStatistics {
	postCount: number;
	commentCount: number;
}

export interface UserWithStats extends UserWithoutStats {
	postCount: number;
	commentCount: number;
}

/**
 * Batch-load statistics for multiple users
 * Executes only 2 queries regardless of user count
 */
async function batchLoadUserStats(userIds: string[]): Promise<Map<string, UserStatistics>> {
	if (userIds.length === 0) {
		return new Map();
	}

	// Get post counts for all users in one query
	const postCounts = await db
		.select({
			authorId: posts.authorId,
			count: sql<number>`count(*)`,
		})
		.from(posts)
		.where(inArray(posts.authorId, userIds))
		.groupBy(posts.authorId);

	// Get comment counts for all users in one query
	const commentCounts = await db
		.select({
			authorId: comments.authorId,
			count: sql<number>`count(*)`,
		})
		.from(comments)
		.where(inArray(comments.authorId, userIds))
		.groupBy(comments.authorId);

	// Build result map
	const statsMap = new Map<string, UserStatistics>();

	userIds.forEach((userId) => {
		const postCount = postCounts.find((pc) => pc.authorId === userId)?.count ?? 0;
		const commentCount = commentCounts.find((cc) => cc.authorId === userId)?.count ?? 0;

		statsMap.set(userId, {
			postCount,
			commentCount,
		});
	});

	return statsMap;
}

/**
 * Enrich users with post/comment counts
 * Prevents N+1 queries by batch-loading all stats.
 */
export async function enrichUsers(users: UserWithoutStats[]): Promise<UserWithStats[]> {
	if (users.length === 0) {
		return [];
	}

	const userIds = users.map((u) => u.id);
	const statsData = await batchLoadUserStats(userIds);

	return users.map((user) => {
		const stats = statsData.get(user.id) ?? {
			postCount: 0,
			commentCount: 0,
		};

		return {
			...user,
			...stats,
		};
	});
}

/**
 * Enrich a single user with statistics
 */
export async function enrichUser(user: UserWithoutStats): Promise<UserWithStats> {
	const enriched = await enrichUsers([user]);
	return enriched[0];
}
