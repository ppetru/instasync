CREATE TABLE ig_posts (
  instagram_id varchar(100) not null PRIMARY KEY,
  parent_instagram_id varchar(100) not null,
  post_id varchar(100),
  caption varchar(1000),
  media_type varchar(100),
  media_url varchar(1000),
  permalink varchar(1000),
  datetime datetime,
  INDEX (parent_instagram_id),
  INDEX (post_id)
);

