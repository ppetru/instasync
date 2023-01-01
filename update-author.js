const GhostAdminAPI = require('@tryghost/admin-api');
const config = require('./config.js');

const api = new GhostAdminAPI(config.api);

api.posts.browse({
  limit: 'all',
  filter: 'tag:photo-post+author:petru'
}).then((posts) => {
  posts.forEach((post) => {
    console.log(post.title, post.published_at);
    api.posts.edit({
      id: post.id,
      updated_at: post.published_at,
      authors: ["hello@alo.land"]
    });
  });
});
