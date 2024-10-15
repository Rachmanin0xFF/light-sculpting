# light-sculpting
Loosely based on patent [US10732405B2](https://patents.google.com/patent/US10732405B2/en).

My take on the problem:
1. We have an incoming irradiance map, $f(x, y)$, and a target irradiance map $g(x, y)$. The goal is to find a transport plan $T:\mathbb{R}^2\rightarrow\mathbb{R}^2$ that squishes $f$ into $g$. Moving the image plane away from the lens should (approximately) trace out a geodesic between $f$ and $g$ in Wasserstein 2-space.
2. We can represent this transport plan as an optical surface if $T$ is curl free; i.e. if we make it so that $T=\nabla H, H:\mathbb{R}^2\rightarrow\mathbb{R}$.
3. My first thought was to use a differentiable rasterizer and just descend into a solution, but I got annoyed with setting up things in Python, so I'm using the [minimizing flows](https://people.math.wisc.edu/~angenent/preprints/mkk.pdf) algorithm developed by Angenent, Haker, and Tannenbaum.

I'm rewriting / porting the code for this over to JS/WebGL and dropping it in here, so hopefully I'll have a nice static web app once I'm done with that. Aiming for .STL export (would be cool to CNC some acrylic once it's set up).

![caustic test](caustics_test.png)
