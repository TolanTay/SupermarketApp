const PageController = {
    showHome: (req, res) => {
        res.render('index', {
            user: req.session.user
        });
    }
};

module.exports = PageController;