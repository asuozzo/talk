const { graphql } = require('graphql');
const { get } = require('lodash');
const path = require('path');

const handle = async (ctx, { comment }) => {
  const { connectors: { graph: { schema } } } = ctx;

  // Check to see if this is a reply to an existing comment.
  const commentID = get(comment, 'id', null);
  if (commentID === null) {
    ctx.log.debug('could not get comment id');
    return;
  }

  // Execute the graph request.
  const reply = await graphql(
    schema,
    `
      query GetAuthorUserMetadata($comment_id: ID!) {
        comment(id: $comment_id) {
          id
          user {
            id
            notificationSettings {
              onFeatured
            }
          }
        }
      }
    `,
    {},
    ctx,
    { comment_id: commentID }
  );
  if (reply.errors) {
    ctx.log.error({ err: reply.errors }, 'could not query for author metadata');
    return;
  }

  // Check if the user has notifications enabled.
  const enabled = get(
    reply,
    'data.comment.user.notificationSettings.onFeatured',
    false
  );
  if (!enabled) {
    return;
  }

  const userID = get(reply, 'data.comment.user.id', null);
  if (!userID) {
    ctx.log.debug('could not get comment user id');
    return;
  }

  // The user does have notifications for featured comments enabled, queue the
  // notification to be sent.
  return { userID, date: comment.created_at, context: comment.id };
};

const hydrate = async (ctx, category, context) => {
  const { connectors: { graph: { schema } } } = ctx;

  const reply = await graphql(
    schema,
    `
      query GetNotificationData($context: ID!) {
        comment(id: $context) {
          id
          asset {
            title
            url
          }
        }
      }
    `,
    {},
    ctx,
    { context }
  );
  if (reply.errors) {
    throw reply.errors;
  }

  const comment = get(reply, 'data.comment');
  const headline = get(comment, 'asset.title', null);
  const assetURL = get(comment, 'asset.url', null);
  const permalink = `${assetURL}?commentId=${comment.id}`;

  return [headline, permalink];
};

const handler = {
  handle,
  category: 'featured',
  event: 'commentFeatured',
  hydrate,
};

module.exports = {
  typeDefs: `
    type NotificationSettings {
      onFeatured: Boolean!
    }

    input NotificationSettingsInput {
      onFeatured: Boolean
    }
  `,
  resolvers: {
    NotificationSettings: {
      // onFeatured returns false by default if not specified.
      onFeatured: settings => get(settings, 'onFeatured', false),
    },
  },
  translations: path.join(__dirname, 'translations.yml'),
  notifications: [handler],
};
