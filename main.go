package main

import (
	"embed"
	"log"
	"self_server/internal/config"
	"self_server/internal/server"
	"self_server/internal/services"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	self_servers_service := services.NewSelfServerService()

	conf, err := config.LoadConfig()
	if err != nil {
		panic(err)
	}

	app := application.New(application.Options{
		Name:        "SelfServer",
		Description: "A demo of using raw HTML & CSS",
		Services: []application.Service{
			application.NewService(self_servers_service),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "SelfServer",
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(27, 38, 54),
		URL:              "/",
		MinWidth:         800,
		MinHeight:        600,
	})

	self_servers_service.App = app
	self_servers_service.Config = conf
	self_servers_service.ServerManager = server.NewManager()

	err = app.Run()

	self_servers_service.ServerManager.StopAll()

	if err != nil {
		log.Fatal(err)
	}
}
