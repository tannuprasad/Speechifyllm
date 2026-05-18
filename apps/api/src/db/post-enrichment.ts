/**
 * Post Enrichment Utility - Batch loads post engagement data
 *
 * This utility prevents N+1 query patterns by batch-loading all post engagement data
 * (likes, comments, bookmark status) in a single set of queries, then mapping it
 * back to post objects.
 *
 * Usage:
 *   const posts = await getPosts(...);
 *   const enrichedPosts = await enrichPosts(posts, userId);
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./index";

const { likes, comments, bookmarks } = schema;

export interface PostWithoutCounts {
	id: string;
	[key: string]: unknown;
}

export interface PostEngagementData {
	likeCount: number;
	commentCount: number;
	isLiked: boolean;
	isBookmarked?: boolean;
}

export interface EnrichedPost extends PostWithoutCounts {
	likeCount: number;
	commentCount: number;
	isLiked: boolean;
	isBookmarked?: boolean;
}

/**
 * Batch-load engagement data (likes, comments) for multiple posts
 * This executes only 2-3 queries regardless of post count
 */
async function batchLoadEngagementData(
	postIds: string[],
	userId?: string,
): Promise<Map<string, PostEngagementData>> {
	if (postIds.length === 0) {
		return new Map();
	}

	// Get all like counts in one query using group by
	const likeCounts = await db
		.select({
			postId: likes.postId,
			count: sql<number>`count(*)`,
		})
		.from(likes)
		.where(inArray(likes.postId, postIds))
		.groupBy(likes.postId);

	// Get all comment counts in one query using group by
	const commentCounts = await db
		.select({
			postId: comments.postId,
			count: sql<number>`count(*)`,
		})
		.from(comments)
		.where(inArray(comments.postId, postIds))
		.groupBy(comments.postId);

	// Check user's likes if userId provided
    let userLikes: Map<string, boolean> = new Map();
	if (userId) {
		const userLikeRecords = await db
			.select({ postId: likes.postId })
			.from(likes)
			.where(and(inArray(likes.postId, postIds), eq(likes.userId, userId)));

		userLikes = new Map(userLikeRecords.map((r) => [r.postId as string, true]));
	}

	// Build result map
	const engagementMap = new Map<string, PostEngagementData>();

	postIds.forEach((postId) => {
		const likeCount = likeCounts.find((lc) => lc.postId === postId)?.count ?? 0;
		const commentCount = commentCounts.find((cc) => cc.postId === postId)?.count ?? 0;
		const isLiked = userLikes.has(postId);

		engagementMap.set(postId, {
			likeCount,
			commentCount,
			isLiked,
		});
	});

	return engagementMap;
}

/**
 * Batch-load bookmark status for a user's posts
 * Returns a map of postId -> bookmarked status
 */
async function batchLoadBookmarkStatus(
	postIds: string[],
	userId?: string,
): Promise<Map<string, boolean>> {
	if (!userId || postIds.length === 0) {
		return new Map();
	}

	const bookmarkedPosts = await db
		.select({ postId: bookmarks.postId })
		.from(bookmarks)
		.where(and(inArray(bookmarks.postId, postIds), eq(bookmarks.userId, userId)));

	return new Map(bookmarkedPosts.map((b) => [b.postId, true]));
}

/**
 * Enrich posts with engagement data (likes, comments, isLiked)
 * Prevents N+1 queries by batch-loading all data.
 *
 * @param posts Array of posts to enrich
 * @param userId Optional user ID to check which posts they've liked/bookmarked
 * @param includeBookmarks Whether to include bookmark status
 * @returns Posts with engagement data attached
 */
export async function enrichPosts(
	posts: PostWithoutCounts[],
	userId?: string,
	includeBookmarks = false,
): Promise<EnrichedPost[]> {
	if (posts.length === 0) {
		return [];
	}

	const postIds = posts.map((p) => p.id);

	// Batch load all engagement data in parallel
	const [engagementData, bookmarkMap] = await Promise.all([
		batchLoadEngagementData(postIds, userId),
		includeBookmarks ? batchLoadBookmarkStatus(postIds, userId) : Promise.resolve(new Map()),
	]);

	// Map engagement data back to posts
	return posts.map((post) => {
		const engagement = engagementData.get(post.id) ?? {
			likeCount: 0,
			commentCount: 0,
			isLiked: false,
		};

		const enriched: EnrichedPost = {
			...post,
			...engagement,
		};

		if (includeBookmarks) {
			enriched.isBookmarked = bookmarkMap.has(post.id);
		}

		return enriched;
	});
}

/**
 * Enrich a single post with engagement data
 * For convenience when working with individual posts
 */
export async function enrichPost(
	post: PostWithoutCounts,
	userId?: string,
	includeBookmarks = false,
): Promise<EnrichedPost> {
	const enriched = await enrichPosts([post], userId, includeBookmarks);
	return enriched[0];
}
