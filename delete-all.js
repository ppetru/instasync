const api = new GhostAdminAPI(config.api);
const config = require('./config.js');

api.posts.browse({
  limit: 'all',
  filter: 'tag:photo-post'
}).then((posts) => {
  posts.forEach((post) => {
    console.log(post.title);
    api.posts.delete({id: post.id});
  });
});
