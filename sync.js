const axios         = require('axios').default;
const mysql         = require('mysql2');
const slugify       = require('slugify');
const GhostAdminAPI = require('@tryghost/admin-api');
const Downloader    = require('nodejs-file-downloader');
const config        = require('./config.js');

const db_conn = mysql.createConnection(config.db_conn).promise();
const api = new GhostAdminAPI(config.api);

async function getInstagramUrl(url) {
    return axios.get(url, {
        headers: { "Accept-Encoding": "gzip,deflate,compress" } 
    });
}

function processInstagramPosts(posts) {
    var postData = [];

    for (post of posts) {

        postData.push([
            post.id,
            post.id,
            post.caption,
            post.media_type,
            post.media_url,
            post.permalink,
            post.timestamp.replace(/\+0000$/, "")
        ]);

        if ('children' in post) {

            for (child of post.children.data) {

                const childId = child.id;

                var caption = null;

                postData.push([
                    post.id,
                    child.id,
                    caption,
                    child.media_type,
                    child.media_url,
                    child.permalink,
                    child.timestamp
                ]);
            }
        }
    }

    return postData;
}

async function pullInstagramPosts() {

    const url = "https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,children{id,media_type,media_url,permalink,thumbnail_url,timestamp}&access_token=" + config.instagramToken;

    var data = await getInstagramUrl(url);
    data = data.data;
    var postData = [];
    const paginate = process.argv[3] || false;

    while (data != null) {
      postData.push(...processInstagramPosts(data.data));
      if (paginate && 'paging' in data && 'next' in data.paging) {
        data = await getInstagramUrl(data.paging.next);
        data = data.data;
      } else {
        data = null;
      }
    }

    const insertSql = "INSERT IGNORE INTO `ig_posts` (`parent_instagram_id`, `instagram_id`, `caption`, `media_type`, `media_url`, `permalink`, `datetime`) VALUES ?";

    console.log("Inserting " + postData.length + " posts");
    await db_conn.query(insertSql, [postData]);
}


//Helper function that returns an appropriate mobiledoc card for the post type
function getAppropriateCard(post, uploadedMediaUrl) {

    if (post.media_type == "VIDEO") {

        return ["html",{"html":"<p><video width=\"100%\" controls><source src=\"" + uploadedMediaUrl + "\" type=\"video/mp4\">Your browser does not support the video tag.</video></p>"}];

    } else {

        return ["image",{"src": uploadedMediaUrl,"alt":"","title":""}];
    }
}


async function doWork() {

  await pullInstagramPosts();

    //Get all the Instagram photos/videos that we have get to post to the blog
    const [posts, _] = await db_conn.query("SELECT * FROM ig_posts WHERE post_id IS NULL AND instagram_id = parent_instagram_id UNION SELECT * FROM ig_posts WHERE post_id IS NULL AND instagram_id != parent_instagram_id");

    const processedPosts = {};

    var cardIndex   = 0;
    var lastParentId = null;

    console.log("Processing " + posts.length + " posts");
    for (post of posts) {

        //Download the media to our server
        const parts    = post.media_url.split('/');
        const fileName = parts[parts.length - 1].split('?')[0];

        const downloader = new Downloader({     
          url: post.media_url,
          directory: "./ig-images",
          fileName: fileName,
          cloneFiles: false,
          skipExistingFileName: true
        })
        
        await downloader.download();//Downloader.download() returns a promise.
 
        //Upload it to the Ghost blog file directory
        console.log("Uploading " + fileName);
        var upload;
        if (fileName.endsWith('mp4')) {
            upload = await api.media.upload({
                file: "ig-images/" + fileName,
            })
        } else {
            upload = await api.images.upload({
                file: "ig-images/" + fileName,
            })
        }

        //This is the return uploaded media url
        const uploadedMediaUrl = upload.url;

        //If the parent Instagram ID differs to the last one then we are working in relation to a different parent post
        if (post.parent_instagram_id != lastParentId) {

            //Reset our media index
            cardIndex = 0;
            lastParentId = post.parent_instagram_id;
        }

        const CARD_SECTION = 10;
        if (post.parent_instagram_id in processedPosts) {
            processedPosts[post.parent_instagram_id]["media_urls"].push(post.media_url);
            processedPosts[post.parent_instagram_id]["rowIds"].push(post.instagram_id);

            //Mobiledoc data
            processedPosts[post.parent_instagram_id]["cards"].push(getAppropriateCard(post, uploadedMediaUrl));
            processedPosts[post.parent_instagram_id]["sections"].push([CARD_SECTION, cardIndex]);

            cardIndex++;
        //This is the first media for this parent ID
        } else {

          //const caption = post.caption != null ? post.caption.replace(/(?:\r\n|\r|\n)/g, '<br>') : "";
            const caption = post.caption != null ? post.caption : "";
            const captionMobileDoc = ["html",{"html": caption}];

            var captionLines = caption.split("\n")
            captionLines = captionLines.filter(function(e){return e}); 

            var mobileDocCards = [];
            var mobileDocSections = [];

            for (line of captionLines) {

                mobileDocSections.push([1,"p",[[0,[],0,line]]]);
            }

            processedPosts[post.parent_instagram_id]                 = {};
            processedPosts[post.parent_instagram_id]["featureImage"] = uploadedMediaUrl;
            if (post.media_type == "VIDEO") {
                processedPosts[post.parent_instagram_id]["featureImage"] = null;

                mobileDocCards.push(getAppropriateCard(post, uploadedMediaUrl));
                mobileDocSections.push([CARD_SECTION, cardIndex]);
                cardIndex++;
            }

            var indexOfFullStop = caption.indexOf('.');
            var indexOfNewLine  = caption.indexOf('\n');
            indexOfFullStop     = indexOfFullStop !== -1 ? indexOfFullStop : 1000;
            indexOfNewLine      = indexOfNewLine !== -1 ? indexOfNewLine : 1000;

            const indexOf = Math.min(indexOfFullStop, indexOfNewLine);

            const postTitle = caption.substr(0, indexOf !== 1000 ? indexOf : caption.length);
            const postSlug  = slugify("Photo " + postTitle);

            var postTags    = [];
            var matchedTags = caption.match(/#[A-Za-z0-9\-]+/gi);
            matchedTags     = matchedTags != null && matchedTags.length > 0 ? matchedTags.map(tag => tag.replace("#", "")) : [];
            postTags.push("photo-post");
            postTags = postTags.concat(matchedTags);

            var publishedAt = post.datetime.toISOString();

            processedPosts[post.parent_instagram_id]["publishedAt"]  = publishedAt;
            processedPosts[post.parent_instagram_id]["postTitle"]    = postTitle;
            processedPosts[post.parent_instagram_id]["postCaption"]  = post.caption;
            processedPosts[post.parent_instagram_id]["postSlug"]     = postSlug;
            processedPosts[post.parent_instagram_id]["postTags"]     = postTags;
            processedPosts[post.parent_instagram_id]["permalink"]    = post.permalink;
            processedPosts[post.parent_instagram_id]["caption"]      = post.caption;
            processedPosts[post.parent_instagram_id]["media_urls"]   = [post.media_url];
            processedPosts[post.parent_instagram_id]["rowIds"]       = [post.instagram_id];

            //Mobiledoc data
            processedPosts[post.parent_instagram_id]["cards"]      = mobileDocCards;
            processedPosts[post.parent_instagram_id]["sections"]   = mobileDocSections;
        }
    }

    //We will now submit the posts to the blog..

    console.log("Submitting " + posts.length + " posts");
    for (instagramParentId of Object.keys(processedPosts)) {

        const processedPost = processedPosts[instagramParentId];

        let featureImage = processedPost["featureImage"];
        let publishedAt  = processedPost["publishedAt"];
        let postTitle    = processedPost["postTitle"];
        let postCaption  = processedPost["postCaption"];
        let postSlug     = processedPost["postSlug"];
        let postTags     = processedPost["postTags"];
        let permalink    = processedPost["permalink"];

        let rowIds    = processedPost["rowIds"];
        let cards     = processedPost["cards"];
        let sections  = processedPost["sections"];

        console.log(cards);
        console.log(sections);

        const mobiledoc = {
            version:  "0.3.2",
            atoms:    [],
            markups:  [],
            cards:    cards,
            sections: sections,
        }

        const res = await api.posts
            .add(
                {
                    title:            postTitle, 
                    slug:             postSlug.substring(0, 190),
                    tags:             postTags,
                    meta_description: postCaption.substring(0, 500),
                    meta_title:       postTitle,
                    feature_image:    featureImage, 
                    status:           "published", 
                    published_at:     publishedAt, 
                    created_at:       publishedAt, 
                    updated_at:       publishedAt, 
                    authors:          ["hello@alo.land"],
                    mobiledoc:        JSON.stringify(mobiledoc)
                },
            )


        const postId = res.id;

        console.log("POSTED: " + postId);

        //Mark the media rows submitted as part of this post as complete
        const updateSql = "UPDATE ig_posts SET post_id = ? WHERE instagram_id IN (?)";
        const updateResponse = await db_conn.query(updateSql, [postId, rowIds]);

        console.log("MARKED AS POSTED");
    }
    console.log("Done");
}

doWork()
  .then(result => { process.exit() });
