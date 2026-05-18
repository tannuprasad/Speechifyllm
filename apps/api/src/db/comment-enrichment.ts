/**
 * Comment Enrichment Utility - Batch loads comment engagement data
 *
 * Prevents N+1 query patterns by batch-loading all comment like data
 * in a single query, then mapping it back to comment objects.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./index";

const { likes } = schema;

export interface CommentWithoutLikes {
	id: string;
	[key: string]: unknown;
}

export interface CommentEngagementData {
	likeCount: number;
	isLiked: boolean;
}

export interface EnrichedComment extends CommentWithoutLikes {
	likeCount: number;
	isLiked: boolean;
	replies?: EnrichedComment[];
}

/**
 * Batch-load like data (counts and user status) for multiple comments
 * Executes only 2 queries regardless of comment count
 */
async function batchLoadCommentLikeData(
	commentIds: string[],
	userId?: string,
): Promise<Map<string, CommentEngagementData>> {
	if (commentIds.length === 0) {
		return new Map();
	}

	// Get all like counts in one query using group by
	const likeCounts = await db
		.select({
			commentId: likes.commentId,
			count: sql<number>`count(*)`,
		})
		.from(likes)
		.where(inArray(likes.commentId, commentIds))
		.groupBy(likes.commentId);

	// Check user's likes if userId provided
	let userLikes: Map<string, boolean> = new Map();
	if (userId) {
		const userLikeRecords = await db
			.select({ commentId: likes.commentId })
			.from(likes)
			.where(and(inArray(likes.commentId, commentIds), eq(likes.userId, userId)));

		userLikes = new Map(userLikeRecords.filter((r) => r.commentId !== null).map((r) => [r.commentId as string, true]));
	}

	// Build result map
	const engagementMap = new Map<string, CommentEngagementData>();

	commentIds.forEach((commentId) => {
		const likeCount = likeCounts.find((lc) => lc.commentId === commentId)?.count ?? 0;
		const isLiked = userLikes.has(commentId);

		engagementMap.set(commentId, {
			likeCount,
			isLiked,
		});
	});

	return engagementMap;
}

/**
 * Enrich comments with like data (counts and isLiked status)
 * Prevents N+1 queries by batch-loading all data.
 */
export async function enrichComments(
	comments: CommentWithoutLikes[],
	userId?: string,
): Promise<EnrichedComment[]> {
	if (comments.length === 0) {
		return [];
	}

	const commentIds = comments.map((c) => c.id);
	const engagementData = await batchLoadCommentLikeData(commentIds, userId);

	return comments.map((comment) => {
		const engagement = engagementData.get(comment.id) ?? {
			likeCount: 0,
			isLiked: false,
		};

		const enriched: EnrichedComment = {
			...comment,
			...engagement,
		};

		// Handle nested replies if they exist
		if (comment.replies && Array.isArray(comment.replies)) {
			enriched.replies = comment.replies;
		}

		return enriched;
	});
}

/**
 * Enrich a single comment with like data
 */
export async function enrichComment(
	comment: CommentWithoutLikes,
	userId?: string,
): Promise<EnrichedComment> {
	const enriched = await enrichComments([comment], userId);
	return enriched[0];
}
