# light-sculpting
Loosely based on patent [US10732405B2](https://patents.google.com/patent/US10732405B2/en).

My take on the problem:
1. This is an optimal transport problem; we're trying to focus an incoming irradiance map $f(x, y)$ to a target irradiance map $g(x, y)$. To first order, our optical surface with heightmap $h(x, y)$ pushes a planar wavefront around by $(n_1/n_2)\nabla h$.
2. The goal is to find the curl-free transport plan $T:\mathbb{R}^2\rightarrow\mathbb{R}^2$ (where $T(v) = v + l\nabla h$ and $l$ depends on the geometry of the setup) that squishes $f$ into $g$. Moving the image plane away (increasing $x$) from the lens should (approximately) trace out a geodesic between $f$ and $g$ in Wasserstein 2-space.
3. My first thought was to use a differentiable rasterizer and just descend into a solution, but I got annoyed with setting up things in Python, so I'm using the [minimizing flows](https://people.math.wisc.edu/~angenent/preprints/mkk.pdf) algorithm developed by Angenent, Haker, and Tannenbaum.

I'm rewriting / porting the code for this over to JS/WebGL and dropping it in here, so hopefully I'll have a nice static web app once I'm done with that. Aiming for .STL export (would be cool to CNC some acrylic once it's set up).

![caustic test](caustics_test.png)
